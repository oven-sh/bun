/**
 * Reads the file lists out of a project's CMake files without running cmake.
 *
 * deps/webkit.ts compiles a local WebKit checkout in bun's own graph. Which
 * files that is (`WTF_SOURCES`, `JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS`, …)
 * is written in WebKit's CMakeLists.txt as `set()` / `list(APPEND)` statements
 * under `if (WIN32)`-style conditions, and changes with the checkout.
 *
 * `parseCMake()` is the language (cmake-language(7)): text → command
 * invocations. `evaluateCMake()` runs the statements that assign variables
 * (`set`, `unset`, `list(APPEND|REMOVE_ITEM)`), takes `if`/`elseif`/`else`
 * branches by cmake's rules, and follows `include()` of a file next to the
 * including one. Every other command is skipped, and so are the bodies of
 * `foreach`/`while`/`function`/`macro`. A condition it cannot decide is an
 * error, never a guess.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { BuildError } from "./error.ts";

export interface Arg {
  /** Quoting removed and escapes applied (bracket content verbatim). Variable references stay as written. */
  text: string;
  kind: "unquoted" | "quoted" | "bracket";
}

export interface Invocation {
  /** Lower-cased command name. */
  name: string;
  args: Arg[];
  file: string;
  line: number;
}

/** Parse one file's text. Throws a BuildError with file:line on malformed input. */
export function parseCMake(src: string, file: string): Invocation[] {
  const out: Invocation[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const fail = (msg: string): never => {
    throw new BuildError(`${file}:${line}: ${msg}`);
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
  /** i at `#`. */
  const skipComment = (): void => {
    const eqs = bracketOpenAt(i + 1);
    if (eqs >= 0) {
      i++;
      readBracket(eqs);
    } else {
      while (i < n && src[i] !== "\n") i++;
    }
  };
  const escapeSequence = (ch: string | undefined): string => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    if (ch === undefined) return fail("backslash at end of input");
    if (/[A-Za-z0-9]/.test(ch)) return fail(`invalid escape sequence \\${ch}`);
    return ch;
  };

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
            text += escapeSequence(nx);
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
      let text = "";
      while (i < n) {
        const u = src[i]!;
        if (u === " " || u === "\t" || u === "\r" || u === "\n" || u === "(" || u === ")" || u === "#") break;
        if (u === "\\") {
          const nx = src[i + 1];
          text += nx === ";" ? "\\;" : escapeSequence(nx);
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
    out.push({ name: rawName.toLowerCase(), args, file, line: cmdLine });
  }
  return out;
}

export interface CMakeEvaluation {
  /** A variable's value as a list; empty when it is not set. */
  list(name: string): string[];
  /** Every file read, the `include()`d ones too: what the result depends on. */
  files: string[];
}

export interface CMakeEvaluateOptions {
  /** Variables set before the first statement: what the surrounding project and cmake itself would have defined. */
  variables: Record<string, string>;
  /** Project macros that amount to an `include()`: lower-cased command name → file, relative to the calling file's directory. A missing file is skipped. */
  includeMacros?: Record<string, string>;
}

/** The blocks whose bodies are definitions or loops, not straight-line assignments: skipped whole. */
const skippedBlocks: Record<string, string> = {
  foreach: "endforeach",
  while: "endwhile",
  function: "endfunction",
  macro: "endmacro",
};

const falseConstant = /^(|0|OFF|NO|FALSE|N|IGNORE|NOTFOUND|.*-NOTFOUND)$/i;
const trueConstant = /^(ON|YES|TRUE|Y|-?[0-9]*\.?[0-9]*[1-9][0-9]*\.?[0-9]*)$/i;

export function evaluateCMake(file: string, options: CMakeEvaluateOptions): CMakeEvaluation {
  const vars = new Map(Object.entries(options.variables));
  const files: string[] = [];

  const expand = (text: string): string => {
    // Innermost references first, so ${${_framework}_SOURCES} resolves.
    for (let next = text; ; text = next) {
      next = text.replace(/\$\{([A-Za-z0-9_.+/-]*)\}/g, (_, name: string) => vars.get(name) ?? "");
      if (next === text) return text;
    }
  };
  /** cmake's argument evaluation: an unquoted argument that expands to a list is that many arguments. */
  const expandArgs = (args: Arg[]): string[] =>
    args.flatMap(a =>
      a.kind === "bracket"
        ? [a.text]
        : a.kind === "quoted"
          ? [expand(a.text)]
          : expand(a.text)
              .split(";")
              .filter(s => s !== ""),
    );

  const condition = (inv: Invocation): boolean => {
    const fail = (why: string): never => {
      throw new BuildError(`${inv.file}:${inv.line}: cannot evaluate ${inv.name}(${render(inv.args)}): ${why}`, {
        hint: "scripts/build/cmake.ts implements the conditions WebKit's file lists use; teach it this one",
      });
    };
    const tokens = inv.args.flatMap(a =>
      a.kind === "unquoted"
        ? expand(a.text)
            .split(";")
            .filter(s => s !== "")
            .map(text => ({ text, quoted: false }))
        : [{ text: a.kind === "quoted" ? expand(a.text) : a.text, quoted: true }],
    );
    let at = 0;
    const isWord = (word: string) => at < tokens.length && !tokens[at]!.quoted && tokens[at]!.text === word;
    /** An operand of a comparison: an unquoted name of a set variable stands for its value. */
    const value = (t: { text: string; quoted: boolean }) => (t.quoted ? t.text : (vars.get(t.text) ?? t.text));
    const truth = (t: { text: string; quoted: boolean }): boolean => {
      if (trueConstant.test(t.text)) return true;
      if (falseConstant.test(t.text) || t.quoted) return false;
      const v = vars.get(t.text);
      return v !== undefined && !falseConstant.test(v);
    };
    const primary = (): boolean => {
      if (isWord("(")) {
        at++;
        const inner = or();
        if (!isWord(")")) fail("unbalanced parentheses");
        at++;
        return inner;
      }
      if (isWord("NOT")) {
        at++;
        return !primary();
      }
      const t = tokens[at++] ?? fail("operand missing");
      if (!t.quoted && (t.text === "DEFINED" || t.text === "EXISTS")) {
        const operand = tokens[at++] ?? fail(`${t.text} without an operand`);
        return t.text === "DEFINED" ? vars.has(operand.text) : existsSync(operand.text);
      }
      // No targets or commands exist here: nothing is built and no macro is defined.
      if (!t.quoted && (t.text === "TARGET" || t.text === "COMMAND")) {
        at++;
        return false;
      }
      const op = tokens[at];
      if (op !== undefined && !op.quoted && (op.text === "STREQUAL" || op.text === "MATCHES")) {
        const rhs = tokens[at + 1] ?? fail(`${op.text} without a right-hand side`);
        at += 2;
        return op.text === "STREQUAL" ? value(t) === value(rhs) : new RegExp(rhs.text).test(value(t));
      }
      if (op !== undefined && !op.quoted && !["AND", "OR", ")"].includes(op.text)) fail(`operator ${op.text}`);
      return truth(t);
    };
    const and = (): boolean => {
      let result = primary();
      while (isWord("AND")) {
        at++;
        const rhs = primary();
        result = result && rhs;
      }
      return result;
    };
    const or = (): boolean => {
      let result = and();
      while (isWord("OR")) {
        at++;
        const rhs = and();
        result = result || rhs;
      }
      return result;
    };
    const result = or();
    if (at !== tokens.length) fail(`unexpected ${tokens[at]!.text}`);
    return result;
  };

  const run = (path: string): void => {
    files.push(path);
    const invocations = parseCMake(readFileSync(path, "utf8"), path);
    const include = (name: string): void => {
      const target = isAbsolute(name) ? name : resolve(dirname(path), name);
      if (existsSync(target)) run(target);
    };
    // One entry per open if(): is its current branch running, and has any branch of it run yet.
    const ifs: Array<{ live: boolean; taken: boolean; outer: boolean }> = [];
    const live = () => ifs.length === 0 || ifs[ifs.length - 1]!.live;

    for (let i = 0; i < invocations.length; i++) {
      const inv = invocations[i]!;
      const end = skippedBlocks[inv.name];
      if (end !== undefined) {
        for (let depth = 1; depth > 0; ) {
          const next = invocations[++i];
          if (next === undefined) throw new BuildError(`${inv.file}:${inv.line}: ${inv.name}() without ${end}()`);
          if (next.name === inv.name) depth++;
          else if (next.name === end) depth--;
        }
        continue;
      }
      switch (inv.name) {
        case "if": {
          const outer = live();
          const taken = outer && condition(inv);
          ifs.push({ live: taken, taken, outer });
          continue;
        }
        case "elseif":
        case "else": {
          const top = ifs[ifs.length - 1];
          if (top === undefined) throw new BuildError(`${inv.file}:${inv.line}: stray ${inv.name}()`);
          top.live = top.outer && !top.taken && (inv.name === "else" || condition(inv));
          top.taken ||= top.live;
          continue;
        }
        case "endif":
          if (ifs.pop() === undefined) throw new BuildError(`${inv.file}:${inv.line}: stray endif()`);
          continue;
      }
      if (!live()) continue;

      const macroInclude = options.includeMacros?.[inv.name];
      if (macroInclude !== undefined) {
        include(macroInclude);
        continue;
      }
      const [first, second, ...rest] = expandArgs(inv.args);
      if (inv.name === "include" && first !== undefined) include(first);
      else if (inv.name === "unset" && first !== undefined) vars.delete(first);
      else if (inv.name === "set" && first !== undefined) {
        const values = second === undefined ? [] : [second, ...rest];
        const stop = values.findIndex(v => v === "CACHE" || v === "PARENT_SCOPE");
        if (values.length === 0) vars.delete(first);
        else vars.set(first, (stop < 0 ? values : values.slice(0, stop)).join(";"));
      } else if (inv.name === "list" && second !== undefined) {
        const current = (vars.get(second) ?? "").split(";").filter(s => s !== "");
        if (first === "APPEND") vars.set(second, [...current, ...rest].join(";"));
        else if (first === "REMOVE_ITEM") vars.set(second, current.filter(item => !rest.includes(item)).join(";"));
      }
    }
    if (ifs.length > 0) throw new BuildError(`${path}: if() without endif()`);
  };
  run(file);

  return { list: name => (vars.get(name) ?? "").split(";").filter(s => s !== ""), files };
}

function render(args: Arg[]): string {
  return args.map(a => (a.kind === "quoted" ? JSON.stringify(a.text) : a.text)).join(" ");
}
