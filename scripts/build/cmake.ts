/**
 * CMake-language parser (cmake-language(7)): source text → the list of
 * command invocations, each with its arguments exactly as written and the
 * chain of flow-control blocks enclosing it. It does not evaluate anything —
 * no variable expansion, no conditions taken — so its output is a faithful,
 * position-independent rendering of what the file *says*.
 *
 * deps/webkit-check-cmake.ts uses it to notice when the WebKit CMake
 * statements bun's build transcribes (deps/webkit.ts) change upstream.
 *
 * Grammar covered: bracket arguments `[==[ … ]==]` and bracket comments,
 * quoted arguments with escape sequences and `\` line continuations, unquoted
 * arguments (including the legacy embedded-quote and `$(VAR)` forms and
 * nested parentheses), `#` line comments, case-insensitive command names.
 */

export interface Arg {
  /** Argument text with quoting removed and escapes applied (bracket content verbatim). Variable references stay as written. */
  text: string;
  kind: "unquoted" | "quoted" | "bracket";
}

export interface Invocation {
  /** Lower-cased command name. */
  name: string;
  args: Arg[];
  file: string;
  line: number;
  /**
   * Enclosing blocks, outermost first, as the header that opens each one
   * would print: `if(NOT WIN32)`, `else() # if(APPLE)`, `foreach(_f IN LISTS X)`,
   * `macro(GENERATE_HASH_LUT _input _output)`. An `else`/`elseif` names the
   * `if` it belongs to after `#`.
   */
  context: string[];
}

export class CMakeSyntaxError extends Error {}

/** Parse one file's text. Throws CMakeSyntaxError with file:line on malformed input. */
export function parseCMake(src: string, file: string): Invocation[] {
  const out: Invocation[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const fail = (msg: string): never => {
    throw new CMakeSyntaxError(`${file}:${line}: ${msg}`);
  };

  /** At a `[`: the `=` count of a bracket open `[==[`, or -1 if it is not one. */
  const bracketOpenAt = (at: number): number => {
    if (src[at] !== "[") return -1;
    let k = at + 1;
    while (src[k] === "=") k++;
    return src[k] === "[" ? k - at - 1 : -1;
  };
  /** i at the opening `[`; consumes through the matching close and returns the content. */
  const readBracket = (eqs: number): string => {
    i += eqs + 2;
    const close = "]" + "=".repeat(eqs) + "]";
    const end = src.indexOf(close, i);
    if (end < 0) fail("unterminated bracket argument");
    let body = src.slice(i, end);
    for (const ch of body) if (ch === "\n") line++;
    i = end + close.length;
    if (body.startsWith("\r\n")) body = body.slice(2);
    else if (body.startsWith("\n")) body = body.slice(1);
    return body;
  };
  const skipComment = (): void => {
    // i at '#'
    const eqs = bracketOpenAt(i + 1);
    if (eqs >= 0) {
      i++;
      readBracket(eqs);
    } else {
      while (i < n && src[i] !== "\n") i++;
    }
  };

  // Block stack for `context`.
  const stack: string[] = [];
  const ifHeaders: string[] = []; // header of the `if` each open if-block started with

  while (i < n) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "﻿") {
      i++;
      continue;
    }
    if (c === "#") {
      skipComment();
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
    if (!m) fail(`expected a command name, got ${JSON.stringify(src.slice(i, i + 24))}`);
    const rawName = m![0];
    const name = rawName.toLowerCase();
    const cmdLine = line;
    i += rawName.length;
    while (i < n && (src[i] === " " || src[i] === "\t")) i++;
    if (src[i] !== "(") fail(`expected '(' after ${rawName}`);
    i++;

    const args: Arg[] = [];
    let depth = 1;
    for (;;) {
      if (i >= n) fail(`unterminated argument list of ${rawName}() starting at line ${cmdLine}`);
      const ch = src[i]!;
      if (ch === "\n") {
        line++;
        i++;
        continue;
      }
      if (ch === " " || ch === "\t" || ch === "\r") {
        i++;
        continue;
      }
      if (ch === "#") {
        skipComment();
        continue;
      }
      if (ch === "(") {
        depth++;
        args.push({ text: "(", kind: "unquoted" });
        i++;
        continue;
      }
      if (ch === ")") {
        i++;
        if (--depth === 0) break;
        args.push({ text: ")", kind: "unquoted" });
        continue;
      }
      const eqs = bracketOpenAt(i);
      if (eqs >= 0) {
        args.push({ text: readBracket(eqs), kind: "bracket" });
        continue;
      }
      if (ch === '"') {
        i++;
        let text = "";
        for (;;) {
          if (i >= n) fail("unterminated quoted argument");
          const q = src[i]!;
          if (q === '"') {
            i++;
            break;
          }
          if (q === "\\") {
            const nx = src[i + 1];
            if (nx === "\n") {
              line++;
              i += 2;
              continue;
            }
            if (nx === "\r" && src[i + 2] === "\n") {
              line++;
              i += 3;
              continue;
            }
            text += escapeSequence(nx, fail);
            i += 2;
            continue;
          }
          if (q === "\n") line++;
          text += q;
          i++;
        }
        args.push({ text, kind: "quoted" });
        continue;
      }
      // Unquoted argument.
      let text = "";
      while (i < n) {
        const u = src[i]!;
        if (u === " " || u === "\t" || u === "\r" || u === "\n" || u === "(" || u === ")" || u === "#") break;
        if (u === "\\") {
          const nx = src[i + 1];
          text += nx === ";" ? "\\;" : escapeSequence(nx, fail);
          i += 2;
          continue;
        }
        if (u === '"') {
          // Legacy form: -DFOO="a b" keeps the quoted run, quotes included.
          text += '"';
          i++;
          while (i < n && src[i] !== '"') {
            if (src[i] === "\\" && i + 1 < n) {
              text += src[i]! + src[i + 1]!;
              i += 2;
              continue;
            }
            if (src[i] === "\n") line++;
            text += src[i++];
          }
          if (i >= n) fail("unterminated quote inside an unquoted argument");
          text += '"';
          i++;
          continue;
        }
        if (u === "$" && src[i + 1] === "(") {
          // Legacy make-style $(VAR): the parentheses belong to the argument.
          const close = src.indexOf(")", i);
          if (close < 0) fail("unterminated $( in an unquoted argument");
          text += src.slice(i, close + 1);
          i = close + 1;
          continue;
        }
        text += u;
        i++;
      }
      args.push({ text, kind: "unquoted" });
    }

    // Flow-control bookkeeping for `context` (the invocation itself is still emitted).
    const header = `${name}(${args.map(renderArg).join(" ")})`;
    switch (name) {
      case "endif":
      case "endforeach":
      case "endwhile":
      case "endfunction":
      case "endmacro":
      case "endblock":
        if (stack.length === 0) fail(`stray ${name}()`);
        stack.pop();
        if (name === "endif") ifHeaders.pop();
        break;
      case "else":
      case "elseif":
        if (ifHeaders.length === 0) fail(`stray ${name}()`);
        stack[stack.length - 1] = `${header} # ${ifHeaders[ifHeaders.length - 1]}`;
        break;
    }
    out.push({ name, args, file, line: cmdLine, context: [...stack] });
    switch (name) {
      case "if":
        ifHeaders.push(header);
        stack.push(header);
        break;
      case "foreach":
      case "while":
      case "function":
      case "macro":
      case "block":
        stack.push(header);
        break;
    }
  }
  if (stack.length > 0) fail(`unterminated block: ${stack[stack.length - 1]}`);
  return out;
}

function escapeSequence(ch: string | undefined, fail: (m: string) => never): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case ";":
      return ";";
    case undefined:
      return fail("backslash at end of input");
    default:
      if (/[A-Za-z0-9]/.test(ch)) fail(`invalid escape sequence \\${ch}`);
      return ch;
  }
}

/** An argument as CMake source: re-quoted when it was quoted or needs it, bracket form for bracket args. */
export function renderArg(a: Arg): string {
  if (a.kind === "bracket") {
    let eqs = "";
    while (a.text.includes(`]${eqs}]`)) eqs += "=";
    return `[${eqs}[${a.text}]${eqs}]`;
  }
  if (a.kind === "quoted")
    return `"${a.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
  return a.text;
}

/** `${NAME}`, `$ENV{NAME}` and `$CACHE{NAME}` references in an argument (nested refs inside a name are returned too). `@NAME@` is not a reference in command arguments — CMake only substitutes it in configure_file()/string(CONFIGURE) input. */
export function variableReferences(a: Arg): string[] {
  if (a.kind === "bracket") return [];
  const names: string[] = [];
  for (const m of a.text.matchAll(/\$(?:ENV|CACHE)?\{([A-Za-z0-9_.+/-]+)\}?/g)) names.push(m[1]!);
  return names;
}

/**
 * Canonical multi-line rendering of an invocation for snapshotting: the
 * context chain as comment lines, then `name(` with one argument per line at
 * keyword boundaries. Independent of the original's whitespace and comments.
 */
export function renderInvocation(inv: Invocation, keywords: ReadonlySet<string> = NO_KEYWORDS): string {
  const lines: string[] = inv.context.map(c => `# in ${c}`);
  const flat = `${inv.name}(${inv.args.map(renderArg).join(" ")})`;
  if (flat.length <= 100 && !inv.args.some(a => a.kind === "unquoted" && keywords.has(a.text))) {
    lines.push(flat);
    return lines.join("\n");
  }
  lines.push(`${inv.name}(`);
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) lines.push("    " + cur.join(" "));
    cur = [];
  };
  for (const a of inv.args) {
    const r = renderArg(a);
    if (a.kind === "unquoted" && keywords.has(a.text)) {
      flush();
      cur.push(r);
    } else if (cur.length >= 1 && (cur.length >= 6 || cur.join(" ").length + r.length > 100)) {
      flush();
      cur.push("   " + r); // continuation indent under its keyword
    } else cur.push(r);
  }
  flush();
  lines.push(")");
  return lines.join("\n");
}
const NO_KEYWORDS: ReadonlySet<string> = new Set();
