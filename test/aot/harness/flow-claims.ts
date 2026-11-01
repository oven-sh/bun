import type { Way } from "../ways-to-enter-a-function";

function isExpression(statement: string) {
  try {
    new Function(`"use strict"; return (${statement.replace(/;$/, "")});`);
    return true;
  } catch {
    return false;
  }
}

/**
 * A CommonJS file that enters a function of its own in each way. Each function hands `this`, its two parameters, `new.target` and the number of its operands to a
 * function that nothing else calls, so the types of that function's parameters are what the flow analysis says of the five. It answers with an object of the
 * file, and where the way is an expression, what the expression gives goes to one more such function.
 * Run plainly, the file prints one line of JSON at its end: for each function that was entered, what was seen in the six places.
 */
export function fileOf(ways: Way[], mode: "strict" | "sloppy") {
  const names = new Map<string, string>();
  const lines = [
    mode === "strict" ? `"use strict";` : ``,
    `const self = { tag: "self" }, other = { tag: "other" }, first = 1.5, second = "text";`,
    `class Other {}`,
    `const base = Symbol("base");`,
    `class Base {}`,
    `const answer = { tag: "answer", done: true };`,
    `const observed = {};`,
    `function kindOf(value) { return value === null ? "null" : typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? typeof value + " " + JSON.stringify(value) : typeof value; }`,
    `function seen(name, ...values) { const kinds = (observed[name] ??= [[], [], [], [], [], []]); values.forEach((value, position) => { if (values.length === 6 && position < 5) return; const kind = kindOf(value); if (!kinds[position].includes(kind)) kinds[position].push(kind); }); }`,
    `function attempt(run) { try { run(); } catch {} }`,
    `process.on("unhandledRejection", () => {});`,
    `process.on("exit", () => { console.log(JSON.stringify(observed)); });`,
  ];
  ways.forEach((way, index) => {
    const name = `${mode}${index}`;
    names.set(name, `${way.name} (${mode})`);
    const [declared, enter] = ((way.declare ?? `function T(a, b) { SEEN }`) + "\n" + way.enter)
      .replaceAll("SEEN0", `k_${name}(this, undefined, undefined, new.target, arguments.length); return answer;`)
      .replaceAll("SEEN1", `k_${name}(this, a, undefined, new.target, arguments.length); return answer;`)
      .replaceAll("SEEN", `k_${name}(this, a, b, new.target, arguments.length); return answer;`)
      .replace(/\bT(?=\b|_)/g, `w_${name}`)
      .split("\n");
    lines.push(`function k_${name}(receiver, a, b, target, count) { seen("${name}", receiver, a, b, target, count); }`);
    if (declared) lines.push(declared.startsWith("(") ? `attempt(() => { ${declared} });` : declared);
    // A value that is missing from what flow lists shows only where flow lists something: so each plain function is also called and constructed with values of its own.
    if (way.declare === undefined)
      lines.push(
        `attempt(() => { w_${name}.call(base, base, base); });`,
        `attempt(() => { Reflect.construct(w_${name}, [base, base], Base); });`,
      );
    if (enter && isExpression(enter)) {
      lines.push(
        `function r_${name}(value) { seen("${name}", undefined, undefined, undefined, undefined, undefined, value); }`,
        `attempt(() => { r_${name}(base); });`,
        `attempt(() => { r_${name}(${enter.replace(/;$/, "")}); });`,
      );
    } else if (enter) lines.push(`attempt(() => { ${enter} });`);
  });
  return { text: lines.join("\n") + "\n", names };
}

function partsOf(type: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < type.length; index++) {
    const character = type[index];
    if (character === '"') for (index++; type[index] !== '"'; index++) if (type[index] === "\\") index++;
    if ("<[({".includes(character)) depth++;
    if (">])}".includes(character)) depth--;
    if (character === "|" && !depth) {
      parts.push(type.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(type.slice(start));
  return parts;
}

function admitsNumber(part: string, value: number) {
  if (part === "number" || part === "double") return true;
  if (part === "int" || part === "i32" || part === "whole") return Number.isInteger(value);
  if (part === "fractional") return !Number.isInteger(value);
  const range = /^int\[(-?\d+), (-?\d+)\]$/.exec(part);
  if (range) return Number.isInteger(value) && value >= Number(range[1]) && value <= Number(range[2]);
  return /^-?\d/.test(part) && Number(part) === value;
}

/** Whether a type of the IR, as text, has room for what was seen: what `typeof` says of it ("null" for null), and behind it a number, a text or a boolean as JSON. */
export function admits(type: string, seen: string) {
  const [kind] = seen.split(" ", 1);
  const value = seen.length > kind.length ? JSON.parse(seen.slice(kind.length + 1)) : undefined;
  return partsOf(type).some(part => {
    if (part === "anything") return true;
    switch (kind) {
      case "undefined":
      case "null":
      case "bigint":
        return part === kind;
      case "boolean":
        return part === "boolean" || part === String(value);
      case "number":
        return admitsNumber(part, value);
      case "string":
        return part === "string" || part === JSON.stringify(value);
      case "symbol":
        return part.startsWith("symbol") || part.startsWith("@@");
      case "function":
        return (
          part === "function" ||
          part === "object" ||
          /^f\d+$/.test(part) ||
          part.startsWith("builtin(") ||
          /^(Proxy|Function|BoundFunction)\b/.test(part)
        );
      case "object":
        return part === "object" || /^L[\d(]/.test(part) || part.startsWith("builtin(") || /^[A-Z]/.test(part);
    }
    throw new Error(`no kind ${kind}`);
  });
}

function fieldOf(line: string, name: string) {
  const start = line.indexOf(` ${name}=[`);
  if (start < 0) return "";
  let depth = 0;
  for (let index = start + name.length + 2; ; index++) {
    if (line[index] === '"') for (index++; line[index] !== '"'; index++) if (line[index] === "\\") index++;
    if ("{[".includes(line[index])) depth++;
    if ("}]".includes(line[index]) && !--depth) return line.slice(start + name.length + 3, index);
  }
}

/** From what `testaot print` prints: for each function `k_<name>`, the types of its parameters. */
export function claimsOf(printed: string) {
  const claims = new Map<string, string[]>();
  for (const line of printed.split("\n")) {
    const [, sink, name] = /^function f\d+ name="([kr])_(\w+)" /.exec(line) ?? [];
    if (!name || / role=/.test(line)) continue;
    const types: string[] = [];
    const parameters = fieldOf(line, "parameters");
    let depth = 0;
    let start = 0;
    for (let index = 0; index < parameters.length; index++) {
      if (parameters[index] === '"')
        for (index++; parameters[index] !== '"'; index++) if (parameters[index] === "\\") index++;
      if (parameters[index] === "{" && !depth++) start = index;
      if (parameters[index] === "}" && !--depth) {
        const record = parameters.slice(start + 1, index);
        const type = /^type=(.*?)(?: (?:site|flags)=.*)?$/.exec(record)![1];
        types.push(/flags=\[[^\]]*IsExpected/.test(record) ? "anything" : type);
      }
    }
    const known = claims.get(name) ?? [];
    if (sink === "k") known.splice(0, 5, ...types);
    else known[5] = types[0];
    claims.set(name, known);
  }
  return claims;
}
