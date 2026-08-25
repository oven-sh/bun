/**
 * Pure parsing helpers for the TypeScript build executor (`executor.ts`).
 *
 * - `expandNinja()`: the `$var` / `$$` / `$ ` expansion ninja applies to rule
 *   strings. The rule commands in this directory are written in that syntax,
 *   so the executor has to evaluate them the same way ninja does.
 * - `parseDepfile()`: Makefile-style `.d` files (clang `-MMD -MF`, nasm `-MD`).
 *   Equivalent of ninja's `deps = gcc`.
 * - `parseShowIncludes()`: clang-cl `/showIncludes` lines on stdout.
 *   Equivalent of ninja's `deps = msvc`.
 */

/**
 * Expand a ninja rule string. Escapes: `$$` → `$`, `$ ` → space, `$:` → `:`,
 * `$` + newline → line continuation. `$name` and `${name}` resolve through
 * `lookup`; an unknown variable expands to the empty string, as in ninja.
 */
export function expandNinja(template: string, lookup: (name: string) => string | undefined): string {
  let out = "";
  let i = 0;
  const n = template.length;
  while (i < n) {
    const ch = template[i]!;
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    const next = template[i + 1];
    if (next === undefined) {
      throw new Error(`expandNinja: dangling '$' at end of ${JSON.stringify(template)}`);
    }
    if (next === "$" || next === " " || next === ":") {
      out += next;
      i += 2;
      continue;
    }
    if (next === "\n" || next === "\r") {
      // Line continuation: skip the newline and the indentation after it.
      i += 2;
      if (next === "\r" && template[i] === "\n") i++;
      while (template[i] === " " || template[i] === "\t") i++;
      continue;
    }
    if (next === "{") {
      const close = template.indexOf("}", i + 2);
      if (close === -1) throw new Error(`expandNinja: unterminated '\${' in ${JSON.stringify(template)}`);
      out += lookup(template.slice(i + 2, close)) ?? "";
      i = close + 1;
      continue;
    }
    let j = i + 1;
    while (j < n && /[A-Za-z0-9_-]/.test(template[j]!)) j++;
    if (j === i + 1) {
      throw new Error(`expandNinja: bad '$' escape at offset ${i} in ${JSON.stringify(template)}`);
    }
    out += lookup(template.slice(i + 1, j)) ?? "";
    i = j;
  }
  return out;
}

export interface Depfile {
  /** Paths before the colon. Usually exactly one: the object file. */
  targets: string[];
  /** Every prerequisite, in file order, deduplicated. */
  deps: string[];
}

/**
 * Parse a Makefile-style dependency file.
 *
 * The escape rules follow ninja's depfile parser (src/depfile_parser.in.cc),
 * since clang and nasm write files for that consumer today:
 * - `\` + newline is a line continuation.
 * - 2N+1 backslashes + space → N backslashes and a space inside the path.
 *   2N backslashes + space → 2N literal backslashes, then the path ends.
 * - `\#` → `#`, `\:` (not followed by whitespace) → `:`, `$$` → `$`.
 * - Any other backslash is literal (Windows path separators in nasm output).
 * - A colon ends a target only when whitespace or end of input follows it,
 *   so `C:\x` is a path, not a rule.
 */
export function parseDepfile(text: string): Depfile {
  const targets: string[] = [];
  const deps: string[] = [];
  const seen = new Set<string>();
  // Tokens before the colon of the current rule. `a b : c` and `a: c` both
  // make `a` a target; nasm writes the former, clang the latter.
  let pendingTargets: string[] = [];
  let parsingTargets = true;
  let token = "";
  let i = 0;
  const n = text.length;

  const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r";

  const endToken = () => {
    if (token.length === 0) return;
    if (parsingTargets) pendingTargets.push(token);
    else if (!seen.has(token)) {
      seen.add(token);
      deps.push(token);
    }
    token = "";
  };
  const colon = () => {
    endToken();
    if (pendingTargets.length === 0) throw new Error("depfile: ':' without a target");
    for (const t of pendingTargets) if (!targets.includes(t)) targets.push(t);
    pendingTargets = [];
    parsingTargets = false;
  };
  const newline = () => {
    endToken();
    if (pendingTargets.length > 0) {
      // Tokens on a line of their own with no colon: more deps (tolerated, as in make).
      for (const t of pendingTargets) {
        if (!seen.has(t)) {
          seen.add(t);
          deps.push(t);
        }
      }
      pendingTargets = [];
    }
    parsingTargets = true;
  };

  while (i < n) {
    const ch = text[i]!;
    if (ch === "\n" || ch === "\r") {
      newline();
      i++;
      continue;
    }
    if (ch === " " || ch === "\t") {
      endToken();
      i++;
      continue;
    }
    if (ch === "\\") {
      let k = 0;
      while (text[i + k] === "\\") k++;
      const next = text[i + k];
      if (next === "\n" || next === "\r") {
        // Line continuation: the rule goes on.
        token += "\\".repeat(k - 1);
        endToken();
        i += k + 1;
        if (next === "\r" && text[i] === "\n") i++;
        continue;
      }
      if (next === " ") {
        if (k % 2 === 1) {
          token += "\\".repeat((k - 1) / 2) + " ";
        } else {
          token += "\\".repeat(k);
          endToken();
        }
        i += k + 1;
        continue;
      }
      if (next === "#") {
        token += "\\".repeat(k - 1) + "#";
        i += k + 1;
        continue;
      }
      if (next === ":" && !isSpace(text[i + k + 1]) && i + k + 1 < n) {
        token += "\\".repeat(k - 1) + ":";
        i += k + 1;
        continue;
      }
      if (k === 1 && (next === "*" || next === "[" || next === "]" || next === "|")) {
        token += next;
        i += 2;
        continue;
      }
      token += "\\".repeat(k);
      i += k;
      continue;
    }
    if (ch === "$" && text[i + 1] === "$") {
      token += "$";
      i += 2;
      continue;
    }
    if (ch === ":") {
      const next = text[i + 1];
      if (next === undefined || isSpace(next)) {
        colon();
        i++;
        continue;
      }
    }
    token += ch;
    i++;
  }
  newline();
  return { targets, deps };
}

/** What ninja's `msvc_deps_prefix` defaults to. clang-cl prints this in English on every locale. */
export const SHOW_INCLUDES_PREFIX = "Note: including file:";

export interface ShowIncludes {
  /** Included headers, in first-seen order, deduplicated. */
  deps: string[];
  /** The compiler output with the include lines removed. This is what the user sees. */
  filtered: string;
}

/**
 * Split clang-cl `/showIncludes` output into header deps and the remaining
 * diagnostics. Mirrors ninja's `CLParser`: include lines are consumed, a
 * first line that only echoes the source filename is dropped too (cl.exe does
 * that; clang-cl does not, but the check is cheap).
 */
export function parseShowIncludes(output: string, sourceFile?: string): ShowIncludes {
  const deps: string[] = [];
  const seen = new Set<string>();
  const kept: string[] = [];
  const lines = output.split(/\r?\n/);
  // `split` on text that ends with a newline leaves a trailing empty string.
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();

  let first = true;
  for (const line of lines) {
    if (line.startsWith(SHOW_INCLUDES_PREFIX)) {
      const path = line.slice(SHOW_INCLUDES_PREFIX.length).trim();
      if (path.length > 0 && !seen.has(path)) {
        seen.add(path);
        deps.push(path);
      }
      continue;
    }
    if (first && sourceFile !== undefined) {
      first = false;
      const base = sourceFile.replace(/^.*[\\/]/, "");
      if (line.trim() === base) continue;
    }
    first = false;
    kept.push(line);
  }
  let filtered = kept.join("\n");
  if (kept.length > 0 && trailingNewline) filtered += "\n";
  return { deps, filtered };
}
