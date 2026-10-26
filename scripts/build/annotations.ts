/**
 * Compiler output captured from a build step, turned into Buildkite annotations.
 */

import {
  escapeCodeBlock,
  escapeHtml,
  getBuildLabel,
  getBuildUrl,
  getFileUrl,
  isBuildkite,
  stripAnsi,
  unescapeGitHubAction,
} from "../buildkite.ts";

function parseLevel(level?: string): "notice" | "warning" | "error" {
  if (/error|fatal|fail/i.test(level ?? "")) {
    return "error";
  }
  if (/warn|caution/i.test(level ?? "")) {
    return "warning";
  }
  return "notice";
}

export interface Annotation {
  title: string;
  content: string;
  source?: string | undefined;
  level?: "notice" | "warning" | "error" | undefined;
  filename?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  metadata?: Record<string, string> | undefined;
}

/** What a log line was matched into, before parseAnnotation() normalizes it. */
interface AnnotationInput {
  title?: string | undefined;
  content?: string | string[] | undefined;
  source?: string | undefined;
  level?: string | undefined;
  filename?: string | undefined;
  line?: string | undefined;
  column?: string | undefined;
  metadata?: Record<string, string | undefined> | undefined;
}

export function parseAnnotation(options: AnnotationInput): Annotation {
  const cwd = process.cwd().replace(/\\/g, "/");
  const source = options.source;
  const level = parseLevel(options.level);
  const title = options.title || (source ? `${source} ${level}` : level);
  const path = options.filename?.replace(/\\/g, "/");
  const line = parseInt(options.line ?? "") || undefined;
  const column = parseInt(options.column ?? "") || undefined;
  const content = options.content;
  const lines = Array.isArray(content) ? content : content?.split(/\r?\n/) || [];
  const metadata = Object.fromEntries(
    Object.entries(options.metadata || {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  // Drop leading blank lines, collapse runs of blank lines, and drop the
  // trailing blank line(s) a readUntil() in parseAnnotations() may have
  // consumed as a block terminator.
  const relevantLines: string[] = [];
  let lastLine: string | undefined;
  for (const line of lines) {
    if (!lastLine && !line.trim()) {
      continue;
    }
    lastLine = line.trim();
    relevantLines.push(line);
  }
  while (relevantLines.length > 0 && !relevantLines[relevantLines.length - 1]?.trim()) {
    relevantLines.pop();
  }

  let filename;
  if (path?.startsWith(cwd)) {
    filename = path.slice(cwd.length + 1);
  } else {
    filename = path;
  }

  return {
    source,
    title,
    level,
    filename,
    line,
    column,
    content: relevantLines.join("\n"),
    metadata,
  };
}

export function formatAnnotationToHtml(annotation: Annotation): string {
  const { title, content, filename, line } = annotation;

  let html = "<details><summary>";

  if (filename) {
    const filePath = filename.replace(/\\/g, "/");
    const fileUrl = getFileUrl(filePath, line);
    if (fileUrl) {
      html += `<a href="${fileUrl}"><code>${filePath}</code></a>`;
    } else {
      html += `<code>${filePath}</code>`;
    }
    html += " - ";
  }

  html += title;

  const buildLabel = getBuildLabel();
  if (buildLabel) {
    html += " on ";
    const buildUrl = getBuildUrl();
    if (buildUrl) {
      html += `<a href="${buildUrl}">${buildLabel}</a>`;
    } else {
      html += buildLabel;
    }
  }

  html += "</summary>\n\n";
  if (isBuildkite) {
    const preview = escapeCodeBlock(content);
    html += `\`\`\`terminal\n${preview}\n\`\`\`\n`;
  } else {
    const preview = escapeHtml(stripAnsi(content));
    html += `<pre><code>${preview}</code></pre>\n`;
  }
  html += "\n\n</details>\n\n";

  return html;
}

interface AnnotationResult {
  annotations: Annotation[];
  content: string;
}

export function parseAnnotations(content: string): AnnotationResult {
  const annotations: Annotation[] = [];

  const originalLines = content.split(/\r?\n/);
  const lines: string[] = [];

  for (let i = 0; i < originalLines.length; i++) {
    const originalLine = originalLines[i]!;
    const line = stripAnsi(originalLine).trim();
    const bufferedLines = [originalLine];

    /**
     * Consume the lines after the current one into `bufferedLines`, through
     * the first line matching `pattern` (inclusive) or `maxLines` lines if
     * none matches. Leaves `i` on the last consumed line, so the outer loop
     * resumes after it; can be called again to consume further.
     */
    const readUntil = (pattern: RegExp, maxLines = 100): { lines: string[]; match: RegExpExecArray | undefined } => {
      const start = i + 1;
      let match: RegExpExecArray | undefined;

      while (i + 1 < originalLines.length && i + 1 - start < maxLines) {
        i++;
        const patternMatch = pattern.exec(stripAnsi(originalLines[i]!).trim());
        if (patternMatch) {
          match = patternMatch;
          break;
        }
      }

      const lines = originalLines.slice(start, i + 1);
      bufferedLines.push(...lines);
      return { lines, match };
    };

    // Github Actions
    // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
    const githubAnnotation = line.match(/^::(error|warning|notice|debug)(?: (.*))?::(.*)$/);
    if (githubAnnotation) {
      const [, level, attributes, content] = githubAnnotation;
      const { file, line, col, title } = Object.fromEntries(
        attributes?.split(",")?.map((entry): [string, string | undefined] => {
          const [key, value] = entry.split("=");
          return [key!, value];
        }) || [],
      );
      const annotation = parseAnnotation({
        level,
        filename: file,
        line,
        column: col,
        // Every parameter of a workflow command is optional, the title too.
        content: unescapeGitHubAction(title ?? "") + unescapeGitHubAction(content!),
      });
      annotations.push(annotation);
      continue;
    }

    const githubCommand = line.match(/^::(group|endgroup|add-mask|stop-commands)::$/);
    if (githubCommand) {
      continue;
    }

    // CMake error format
    // e.g. CMake Error at /path/to/thing.cmake:123 (message): ...
    const cmakeMessage = line.match(/CMake (Error|Warning|Deprecation Warning) at (.*):(\d+)/i);
    if (cmakeMessage) {
      let [, level, filename, line] = cmakeMessage;

      const { match: callStackMatch } = readUntil(/Call Stack \(most recent call first\)/i);
      if (callStackMatch) {
        const { match: callFrameMatch } = readUntil(/(CMakeLists\.txt|[^\s]+\.cmake):(\d+)/i, 5);
        if (callFrameMatch) {
          const [, frame, location] = callFrameMatch;
          filename = frame;
          line = location;
        }
      }

      const annotation = parseAnnotation({
        source: "cmake",
        level,
        filename,
        line,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    // rustc / cargo error
    // e.g. error[E0308]: mismatched types
    //        --> src/http/lib.rs:553:5
    // The header line carries the level + (optional) code; the location
    // arrives on the following `-->` line (absent for diagnostics without a
    // span, e.g. "error: linking with `cc` failed"). The body runs until the
    // blank line rustc emits after every diagnostic, so the annotation
    // contains the rendered span + help/note lines; the cap is only a guard
    // against output that never has one.
    const rustHeader = line.match(/^(error|warning)(\[[A-Z0-9]+\])?: (.+)$/);
    if (rustHeader && !/\b(generated|emitted)\b/.test(line) /* "warning: 3 warnings emitted" */) {
      const [, level, code, title] = rustHeader;
      const { lines: body } = readUntil(/^$/, 30);
      const locMatch = stripAnsi(body[0] ?? "").match(/-->\s+(.+?):(\d+):(\d+)/);
      const annotation = parseAnnotation({
        source: "rustc",
        level,
        filename: locMatch?.[1],
        line: locMatch?.[2],
        column: locMatch?.[3],
        title: code ? `${code} ${title}` : title,
        content: bufferedLines,
      });
      annotations.push(annotation);
      continue;
    }

    const nodeJsError = line.match(/^file:\/\/(.+\.(?:c|m)js):(\d+)/i);
    if (nodeJsError) {
      const [, filename, line] = nodeJsError;

      let metadata: Record<string, string | undefined> | undefined;
      const { match: nodeJsVersionMatch } = readUntil(/^Node\.js v(\d+\.\d+\.\d+)/i);
      if (nodeJsVersionMatch) {
        const [, version] = nodeJsVersionMatch;
        metadata = {
          "node-version": version,
        };
      }

      const annotation = parseAnnotation({
        source: "node",
        level: "error",
        filename,
        line,
        content: bufferedLines,
        metadata,
      });
      annotations.push(annotation);
    }

    const clangError = line.match(/^(.+\.(?:cpp|c|m|h)):(\d+):(\d+): (error|warning): (.+)/i);
    if (clangError) {
      const [, filename, line, column, level] = clangError;
      readUntil(/^\d+ (?:error|warning)s? generated/);
      const annotation = parseAnnotation({
        source: "clang",
        level,
        filename,
        line,
        column,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    const shellMessage = line.match(/(.+\.sh): line (\d+): (.+)/i);
    if (shellMessage) {
      const [, filename, line] = shellMessage;
      const annotation = parseAnnotation({
        source: "shell",
        level: "error",
        filename,
        line,
        content: bufferedLines,
      });
      annotations.push(annotation);
    }

    lines.push(originalLine);
  }

  return {
    annotations,
    content: lines.join("\n"),
  };
}
