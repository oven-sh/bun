/**
 * Just enough of a CMake interpreter to read source/header lists out of a
 * dependency's CMakeLists.txt: `set()`, `list(APPEND|REMOVE_ITEM)`,
 * `if/elseif/else/endif` with CMake's condition grammar, `foreach` over
 * lists, `include()` of sibling files, `${VAR}` expansion. Everything else
 * (targets, properties, custom commands, macros) is skipped.
 *
 * Used by the direct WebKit build so JSC/WTF/bmalloc file lists come from
 * WebKit's own CMakeLists instead of a copy that drifts on every WebKit bump.
 * The caller seeds the variables the conditionals test (WIN32, APPLE,
 * CMAKE_SYSTEM_NAME, ENABLE_*, USE_*, WTF_CPU_* ...) and reads back the
 * list variables it wants.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { BuildError } from "./error.ts";

export type CMakeVars = Map<string, string[]>;

interface Command {
  name: string;
  /** Raw argument tokens: quoted strings keep their quotes stripped but are marked. */
  args: Arg[];
  line: number;
}

interface Arg {
  text: string;
  quoted: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Lexing: file → commands
// ───────────────────────────────────────────────────────────────────────────

function parseCommands(src: string, file: string): Command[] {
  const out: Command[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const err = (msg: string): never => {
    throw new BuildError(`${file}:${line}: ${msg}`);
  };
  while (i < n) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      // Comment (bracket comments `#[[ ]]` included).
      if (src.startsWith("#[[", i)) {
        const end = src.indexOf("]]", i);
        if (end < 0) err("unterminated bracket comment");
        for (let k = i; k < end; k++) if (src[k] === "\n") line++;
        i = end + 2;
      } else {
        while (i < n && src[i] !== "\n") i++;
      }
      continue;
    }
    // Command name.
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128));
    if (!m) err(`unexpected character ${JSON.stringify(c)}`);
    const name = m![0].toLowerCase();
    i += m![0].length;
    while (i < n && (src[i] === " " || src[i] === "\t")) i++;
    if (src[i] !== "(") err(`expected ( after ${name}`);
    i++;
    const cmdLine = line;
    const args: Arg[] = [];
    let depth = 0;
    for (;;) {
      if (i >= n) err(`unterminated ${name}(`);
      const ch = src[i]!;
      if (ch === "\n") {
        line++;
        i++;
      } else if (ch === " " || ch === "\t" || ch === "\r") {
        i++;
      } else if (ch === "#") {
        while (i < n && src[i] !== "\n") i++;
      } else if (ch === "(") {
        depth++;
        args.push({ text: "(", quoted: false });
        i++;
      } else if (ch === ")") {
        i++;
        if (depth === 0) break;
        depth--;
        args.push({ text: ")", quoted: false });
      } else if (ch === '"') {
        let j = i + 1;
        let text = "";
        while (j < n && src[j] !== '"') {
          if (src[j] === "\\" && j + 1 < n) {
            const e = src[j + 1]!;
            text += e === "n" ? "\n" : e === "t" ? "\t" : e;
            j += 2;
          } else {
            if (src[j] === "\n") line++;
            text += src[j];
            j++;
          }
        }
        if (j >= n) err("unterminated string");
        args.push({ text, quoted: true });
        i = j + 1;
      } else if (src.startsWith("[[", i) || /^\[=*\[/.test(src.slice(i, i + 8))) {
        const open = /^\[(=*)\[/.exec(src.slice(i))!;
        const close = `]${open[1]}]`;
        const end = src.indexOf(close, i + open[0].length);
        if (end < 0) err("unterminated bracket argument");
        const text = src.slice(i + open[0].length, end);
        for (const k of text) if (k === "\n") line++;
        args.push({ text, quoted: true });
        i = end + close.length;
      } else {
        let j = i;
        let text = "";
        while (j < n && !/[\s()#"]/.test(src[j]!)) {
          if (src[j] === "\\" && j + 1 < n) {
            text += src[j + 1];
            j += 2;
          } else {
            text += src[j];
            j++;
          }
        }
        args.push({ text, quoted: false });
        i = j;
      }
    }
    out.push({ name, args, line: cmdLine });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Evaluation
// ───────────────────────────────────────────────────────────────────────────

export interface EvalOptions {
  /**
   * Called for `include(<file>)`. Return the absolute path to read, or
   * undefined to skip it. Default: skip every include.
   */
  resolveInclude?: (arg: string, fromFile: string) => string | undefined;
  /**
   * Called for every command this interpreter does not implement (macro
   * invocations such as WEBKIT_INCLUDE_CONFIG_FILES_IF_EXISTS, add_custom_command,
   * ...), with arguments expanded. `name` is lower-cased.
   */
  onCommand?: (name: string, args: string[], file: string, line: number) => void;
}

export function evaluateCMake(file: string, vars: CMakeVars, opts: EvalOptions = {}): void {
  const src = readFileSync(file, "utf8");
  const cmds = parseCommands(src, file);
  run(cmds, file, vars, opts);
}

const FALSE_CONSTANTS = new Set(["", "0", "OFF", "NO", "FALSE", "N", "IGNORE", "NOTFOUND"]);
const TRUE_CONSTANTS = new Set(["1", "ON", "YES", "TRUE", "Y"]);

function expand(arg: Arg, vars: CMakeVars): string[] {
  // ${VAR} expansion, then list splitting for unquoted args.
  const text = arg.text.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, v: string) => (vars.get(v) ?? []).join(";"));
  // $ENV{X} → empty.
  const noEnv = text.replace(/\$ENV\{[^}]*\}/g, "");
  if (arg.quoted) return [noEnv];
  if (noEnv === "") return [];
  return noEnv.split(";").filter(s => s !== "");
}

function expandAll(args: Arg[], vars: CMakeVars): string[] {
  return args.flatMap(a => expand(a, vars));
}

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const u = value.toUpperCase();
  if (FALSE_CONSTANTS.has(u) || u.endsWith("-NOTFOUND")) return false;
  if (TRUE_CONSTANTS.has(u)) return true;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value) !== 0;
  return true;
}

/** CMake `if()` semantics for a bare token: constant, else variable lookup. */
function tokenTruthy(tok: Arg, vars: CMakeVars): boolean {
  const t = expand(tok, vars).join(";");
  const u = t.toUpperCase();
  if (!tok.quoted) {
    if (TRUE_CONSTANTS.has(u)) return true;
    if (FALSE_CONSTANTS.has(u) || u.endsWith("-NOTFOUND")) return false;
    if (/^-?\d+$/.test(t)) return Number(t) !== 0;
    // Variable reference: true when defined to anything but a false constant.
    const v = vars.get(t);
    if (v === undefined) return false;
    const joined = v.join(";").toUpperCase();
    return !(FALSE_CONSTANTS.has(joined) || joined.endsWith("-NOTFOUND"));
  }
  // Quoted: a string; true only if it's a true constant (policy CMP0012 NEW).
  return truthy(t);
}

/** Auto-dereference: unquoted token naming a defined variable → its value. */
function operand(tok: Arg, vars: CMakeVars): string {
  const t = expand(tok, vars).join(";");
  if (!tok.quoted && vars.has(t)) return vars.get(t)!.join(";");
  return t;
}

function evalCondition(args: Arg[], vars: CMakeVars, where: string): boolean {
  let pos = 0;
  const peek = (): Arg | undefined => args[pos];
  const kw = (a: Arg | undefined, k: string) => a !== undefined && !a.quoted && a.text.toUpperCase() === k;

  const parseOr = (): boolean => {
    let v = parseAnd();
    while (kw(peek(), "OR")) {
      pos++;
      const r = parseAnd();
      v = v || r;
    }
    return v;
  };
  const parseAnd = (): boolean => {
    let v = parseNot();
    while (kw(peek(), "AND")) {
      pos++;
      const r = parseNot();
      v = v && r;
    }
    return v;
  };
  const parseNot = (): boolean => {
    if (kw(peek(), "NOT")) {
      pos++;
      return !parseNot();
    }
    return parsePrimary();
  };
  const BINARY = new Set([
    "STREQUAL",
    "MATCHES",
    "EQUAL",
    "LESS",
    "GREATER",
    "LESS_EQUAL",
    "GREATER_EQUAL",
    "STRLESS",
    "STRGREATER",
    "VERSION_LESS",
    "VERSION_GREATER",
    "VERSION_EQUAL",
    "VERSION_LESS_EQUAL",
    "VERSION_GREATER_EQUAL",
    "IN_LIST",
  ]);
  const parsePrimary = (): boolean => {
    const a = peek();
    if (a === undefined) throw new BuildError(`${where}: truncated if() condition`);
    if (!a.quoted && a.text === "(") {
      pos++;
      const v = parseOr();
      if (!kw(peek(), ")") && peek()?.text !== ")") throw new BuildError(`${where}: expected ) in if()`);
      pos++;
      return v;
    }
    const u = a.quoted ? "" : a.text.toUpperCase();
    if (u === "EXISTS" || u === "IS_DIRECTORY") {
      pos += 2;
      return existsSync(expand(args[pos - 1]!, vars).join(";"));
    }
    if (u === "DEFINED") {
      pos += 2;
      const name = args[pos - 1]!.text;
      if (name.startsWith("ENV{")) return false;
      return vars.has(name);
    }
    if (u === "TARGET" || u === "COMMAND" || u === "POLICY" || u === "TEST") {
      pos += 2;
      return false;
    }
    if (u === "IS_ABSOLUTE") {
      pos += 2;
      return expand(args[pos - 1]!, vars)
        .join(";")
        .startsWith("/");
    }
    // Binary operator lookahead.
    const op = args[pos + 1];
    if (op !== undefined && !op.quoted && BINARY.has(op.text.toUpperCase())) {
      const lhs = operand(a, vars);
      const rhs = operand(args[pos + 2]!, vars);
      pos += 3;
      switch (op.text.toUpperCase()) {
        case "STREQUAL":
          return lhs === rhs;
        case "MATCHES":
          return new RegExp(rhs).test(lhs);
        case "EQUAL":
          return Number(lhs) === Number(rhs);
        case "LESS":
          return Number(lhs) < Number(rhs);
        case "GREATER":
          return Number(lhs) > Number(rhs);
        case "LESS_EQUAL":
          return Number(lhs) <= Number(rhs);
        case "GREATER_EQUAL":
          return Number(lhs) >= Number(rhs);
        case "STRLESS":
          return lhs < rhs;
        case "STRGREATER":
          return lhs > rhs;
        case "IN_LIST":
          return (vars.get(args[pos - 1]!.text) ?? []).includes(lhs);
        default: {
          // VERSION_* : compare dotted numerics.
          const pa = lhs.split(".").map(Number);
          const pb = rhs.split(".").map(Number);
          let cmp = 0;
          for (let i = 0; i < Math.max(pa.length, pb.length) && cmp === 0; i++) {
            cmp = Math.sign((pa[i] ?? 0) - (pb[i] ?? 0));
          }
          const o = op.text.toUpperCase();
          if (o === "VERSION_LESS") return cmp < 0;
          if (o === "VERSION_GREATER") return cmp > 0;
          if (o === "VERSION_EQUAL") return cmp === 0;
          if (o === "VERSION_LESS_EQUAL") return cmp <= 0;
          return cmp >= 0;
        }
      }
    }
    pos++;
    return tokenTruthy(a, vars);
  };

  const result = parseOr();
  if (pos !== args.length) {
    throw new BuildError(
      `${where}: could not parse if() condition past token ${pos}: ${args.map(a => a.text).join(" ")}`,
    );
  }
  return result;
}

/** Index of the command that closes the block opened at `start` (if→endif etc.), honoring nesting. */
function findBlockEnd(cmds: Command[], start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < cmds.length; i++) {
    const nm = cmds[i]!.name;
    if (nm === open) depth++;
    else if (nm === close && --depth === 0) return i;
  }
  throw new BuildError(`unterminated ${open}() at command ${start}`);
}

function run(cmds: Command[], file: string, vars: CMakeVars, opts: EvalOptions): void {
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i]!;
    switch (c.name) {
      case "set": {
        const name = expand(c.args[0]!, vars).join(";");
        const rest = c.args
          .slice(1)
          .filter(a => !(a.text === "PARENT_SCOPE" || a.text === "CACHE" || a.text === "FORCE"));
        // set(X CACHE TYPE "doc") — drop the type/doc after CACHE.
        const cacheAt = c.args.findIndex(a => !a.quoted && a.text === "CACHE");
        const valueArgs = cacheAt >= 0 ? c.args.slice(1, cacheAt) : rest;
        if (valueArgs.length === 0) vars.delete(name);
        else vars.set(name, expandAll(valueArgs, vars));
        break;
      }
      case "unset":
        vars.delete(expand(c.args[0]!, vars).join(";"));
        break;
      case "list": {
        const sub = c.args[0]!.text.toUpperCase();
        const name = expand(c.args[1]!, vars).join(";");
        const cur = vars.get(name) ?? [];
        if (sub === "APPEND") vars.set(name, [...cur, ...expandAll(c.args.slice(2), vars)]);
        else if (sub === "PREPEND" || sub === "INSERT") {
          const items = expandAll(c.args.slice(sub === "INSERT" ? 3 : 2), vars);
          vars.set(name, [...items, ...cur]);
        } else if (sub === "REMOVE_ITEM") {
          const rm = new Set(expandAll(c.args.slice(2), vars));
          vars.set(
            name,
            cur.filter(x => !rm.has(x)),
          );
        } else if (sub === "REMOVE_DUPLICATES") vars.set(name, [...new Set(cur)]);
        else if (sub === "FILTER") {
          const mode = c.args[2]!.text.toUpperCase(); // INCLUDE|EXCLUDE
          const re = new RegExp(expand(c.args[4]!, vars).join(";"));
          vars.set(
            name,
            cur.filter(x => re.test(x) === (mode === "INCLUDE")),
          );
        }
        // LENGTH/GET/FIND/JOIN/SORT/TRANSFORM: not needed for source lists.
        break;
      }
      case "string": {
        // Only the forms the WebKit lists use around source selection.
        const sub = c.args[0]!.text.toUpperCase();
        if (sub === "TOLOWER" || sub === "TOUPPER") {
          const v = expand(c.args[1]!, vars).join(";");
          vars.set(c.args[2]!.text, [sub === "TOLOWER" ? v.toLowerCase() : v.toUpperCase()]);
        } else if (sub === "APPEND") {
          const name = c.args[1]!.text;
          vars.set(name, [(vars.get(name) ?? []).join(";") + expandAll(c.args.slice(2), vars).join("")]);
        } else if (sub === "REGEX" && c.args[1]!.text.toUpperCase() === "REPLACE") {
          const re = new RegExp(expand(c.args[2]!, vars).join(";"), "g");
          const rep = expand(c.args[3]!, vars)
            .join(";")
            .replace(/\\(\d)/g, "$$$1");
          const outVar = c.args[4]!.text;
          const input = expandAll(c.args.slice(5), vars).join(";");
          vars.set(outVar, [input.replace(re, rep)]);
        } else if (sub === "REPLACE") {
          const from = expand(c.args[1]!, vars).join(";");
          const to = expand(c.args[2]!, vars).join(";");
          const outVar = c.args[3]!.text;
          const input = expandAll(c.args.slice(4), vars).join(";");
          vars.set(outVar, [input.split(from).join(to)]);
        }
        break;
      }
      case "if": {
        // Collect the if/elseif/else arms up to the matching endif.
        const end = findBlockEnd(cmds, i, "if", "endif");
        const arms: Array<{ cond: Arg[] | null; from: number; to: number; line: number }> = [];
        let armStart = i;
        let depth = 0;
        for (let k = i + 1; k < end; k++) {
          const nm = cmds[k]!.name;
          if (nm === "if") depth++;
          else if (nm === "endif") depth--;
          else if (depth === 0 && (nm === "elseif" || nm === "else")) {
            arms.push({
              cond: cmds[armStart]!.name === "else" ? null : cmds[armStart]!.args,
              from: armStart + 1,
              to: k,
              line: cmds[armStart]!.line,
            });
            armStart = k;
          }
        }
        arms.push({
          cond: cmds[armStart]!.name === "else" ? null : cmds[armStart]!.args,
          from: armStart + 1,
          to: end,
          line: cmds[armStart]!.line,
        });
        for (const arm of arms) {
          if (arm.cond === null || evalCondition(arm.cond, vars, `${file}:${arm.line}`)) {
            run(cmds.slice(arm.from, arm.to), file, vars, opts);
            break;
          }
        }
        i = end;
        break;
      }
      case "foreach": {
        const end = findBlockEnd(cmds, i, "foreach", "endforeach");
        const body = cmds.slice(i + 1, end);
        const loopVar = c.args[0]!.text;
        let items: string[];
        const a1 = c.args[1]?.text.toUpperCase();
        if (a1 === "IN") {
          items = [];
          let mode = "";
          for (const a of c.args.slice(2)) {
            const u = a.text.toUpperCase();
            if (!a.quoted && (u === "LISTS" || u === "ITEMS")) mode = u;
            else if (mode === "LISTS") items.push(...(vars.get(a.text) ?? []));
            else items.push(...expand(a, vars));
          }
        } else if (a1 === "RANGE") {
          items = [];
        } else {
          items = expandAll(c.args.slice(1), vars);
        }
        for (const item of items) {
          vars.set(loopVar, [item]);
          run(body, file, vars, opts);
        }
        i = end;
        break;
      }
      case "while": {
        i = findBlockEnd(cmds, i, "while", "endwhile");
        break;
      }
      case "macro":
        i = findBlockEnd(cmds, i, "macro", "endmacro");
        break;
      case "function":
        i = findBlockEnd(cmds, i, "function", "endfunction");
        break;
      case "include": {
        const target = opts.resolveInclude?.(expand(c.args[0]!, vars).join(";"), file);
        if (target !== undefined && existsSync(target)) {
          const saved = vars.get("CMAKE_CURRENT_LIST_DIR");
          vars.set("CMAKE_CURRENT_LIST_DIR", [dirname(target)]);
          evaluateCMake(target, vars, opts);
          if (saved !== undefined) vars.set("CMAKE_CURRENT_LIST_DIR", saved);
        }
        break;
      }
      case "option": {
        const name = c.args[0]!.text;
        if (!vars.has(name)) vars.set(name, [c.args[2]?.text ?? "OFF"]);
        break;
      }
      case "return":
        return;
      default:
        opts.onCommand?.(c.name, expandAll(c.args, vars), file, c.line);
        break;
    }
  }
}

/** Convenience: variables map from a plain record. */
export function cmakeVars(init: Record<string, string | string[] | boolean>): CMakeVars {
  const m: CMakeVars = new Map();
  for (const [k, v] of Object.entries(init)) {
    if (typeof v === "boolean") m.set(k, [v ? "ON" : "OFF"]);
    else m.set(k, Array.isArray(v) ? v : [v]);
  }
  return m;
}
