// A drawn program is a closed world: the compiler sees where every object, function, class and key comes from, and proves the receiver, the callee and the arguments of nearly every call.
// In a program that uses packages it expects them instead, and keeps a way back. `launderValues` hands values of a program through a function whose text the build cannot know, so that
// what follows them is compiled on expectations. The function returns what it is given: the program does what it did. In TypeScript the value keeps its declared type.

/** For every character, whether it is code: not in a comment, a string, a template or a regular expression. */
function findCode(text: string): Uint8Array {
  const isCode = new Uint8Array(text.length).fill(1);
  let at = 0;
  let last = "";
  const skipTo = (end: number) => {
    isCode.fill(0, at, end);
    at = end;
  };
  const template = () => {
    const start = at++;
    while (at < text.length && text[at] !== "`") {
      if (text[at] === "\\") at += 2;
      else if (text[at] === "$" && text[at + 1] === "{") {
        at += 2;
        code("}");
        at++;
      } else at++;
    }
    at++;
    isCode.fill(0, start, at);
  };
  function code(until: string) {
    let depth = 0;
    while (at < text.length) {
      const c = text[at];
      if (until && c === until && depth === 0) return;
      if (c === "{") depth++;
      else if (c === "}") depth--;
      if (c === "/" && text[at + 1] === "/") {
        const end = text.indexOf("\n", at);
        skipTo(end < 0 ? text.length : end);
      } else if (c === "/" && text[at + 1] === "*") {
        const end = text.indexOf("*/", at + 2);
        skipTo(end < 0 ? text.length : end + 2);
      } else if (c === '"' || c === "'") {
        let end = at + 1;
        while (end < text.length && text[end] !== c && text[end] !== "\n") end += text[end] === "\\" ? 2 : 1;
        skipTo(end + 1);
        last = c;
      } else if (c === "`") {
        template();
        last = c;
      } else if (c === "/" && (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last))) {
        let end = at + 1;
        let inClass = false;
        while (end < text.length && text[end] !== "\n" && (inClass || text[end] !== "/")) {
          if (text[end] === "\\") end++;
          else if (text[end] === "[") inClass = true;
          else if (text[end] === "]") inClass = false;
          end++;
        }
        skipTo(end + 1);
        last = "/";
      } else {
        if (c.trim()) last = c;
        at++;
      }
    }
  }
  code("");
  return isCode;
}

type Place = { kind: string; start: number; end: number; before: string; after: string };

const opening = "([{";
const closing = ")]}";

/** The index behind the bracket that closes the one at `from`. */
function skipBrackets(text: string, isCode: Uint8Array, from: number) {
  let depth = 0;
  for (let at = from; at < text.length; at++) {
    if (!isCode[at]) continue;
    if (opening.includes(text[at])) depth++;
    else if (closing.includes(text[at]) && --depth === 0) return at + 1;
  }
  return -1;
}

function kindOf(written: string) {
  if (/^(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>|<)/.test(written)) return "function";
  if (/^class\b/.test(written)) return "class";
  if (/^\(*\{/.test(written) || /^\(*new\b/.test(written)) return "object";
  if (/^\(*\[/.test(written)) return "list";
  if (/^\(*["'`]/.test(written)) return "text";
  if (/^\(*-?[\d.]/.test(written)) return "number";
  return "other";
}

function findPlaces(text: string, name: string): Place[] {
  const isCode = findCode(text);
  const places: Place[] = [];
  for (const found of text.matchAll(/\b(?:const|let|var) ([A-Za-z_$][\w$]*)/g)) {
    if (!isCode[found.index] || /^(?:printValue|note|show|out|enum)$/.test(found[1])) continue;
    let at = found.index + found[0].length;
    // The declared type, up to the `=` behind it.
    let depth = 0;
    for (; at < text.length; at++) {
      if (!isCode[at]) continue;
      const c = text[at];
      if ("([{<".includes(c)) depth++;
      else if (")]}".includes(c) || (c === ">" && text[at - 1] !== "=")) depth--;
      else if (depth === 0 && (c === ";" || c === "," || c === "\n")) break;
      else if (depth === 0 && c === "=" && text[at + 1] !== ">" && text[at + 1] !== "=") break;
      if (depth < 0) break;
      if (depth === 0 && c === " " && /^ (?:of|in) /.test(text.slice(at, at + 4))) break;
    }
    if (text[at] !== "=" || depth !== 0) continue;
    let start = at + 1;
    while (text[start] === " ") start++;
    // The value, up to the `;` or the `,` behind it.
    let angles = 0;
    let end = start;
    for (depth = 0; end < text.length; end++) {
      if (!isCode[end]) continue;
      const c = text[end];
      if (opening.includes(c)) depth++;
      else if (closing.includes(c)) depth--;
      else if (c === "<" && /[\w$]/.test(text[end - 1] ?? "")) angles++;
      else if (c === ">" && angles > 0 && text[end - 1] !== "=") angles--;
      if (depth < 0) break;
      if (depth === 0 && (c === ";" || (c === "," && angles === 0) || c === "\n")) break;
    }
    const written = text.slice(start, end);
    if (text[end] === "\n" || end >= text.length || !written.trim()) continue;
    if (/^(?:await\s+)?(?:require|import)\b/.test(written) || written.startsWith(name + "(")) continue;
    places.push({ kind: kindOf(written), start, end, before: `${name}(`, after: ")" });
  }
  // A function or a class that is declared is handed through behind its declaration.
  for (const found of text.matchAll(/^([ \t]*)(?:async )?(function\*?|class) ([A-Za-z_$][\w$]*)/gm)) {
    if (!isCode[found.index + found[1].length]) continue;
    let at = found.index + found[0].length;
    if (found[2] !== "class") {
      while (at < text.length && text[at] !== "(") at++;
      at = skipBrackets(text, isCode, at);
      if (at < 0) continue;
    }
    let depth = 0;
    for (; at < text.length; at++) {
      if (!isCode[at]) continue;
      if (text[at] === "{" && depth === 0) break;
      if ("([<".includes(text[at])) depth++;
      else if (")]>".includes(text[at]) && text[at - 1] !== "=") depth--;
      if (text[at] === ";" && depth === 0) break;
    }
    if (text[at] !== "{") continue;
    const end = skipBrackets(text, isCode, at);
    if (end < 0) continue;
    const kind = found[2] === "class" ? "class" : "function";
    places.push({ kind, start: end, end, before: `\n${found[1]}${found[3]} = ${name}(${found[3]});`, after: "" });
  }
  // A key that is written in brackets.
  for (const found of text.matchAll(/(?<=[\w$)\]])\[("[\w$ -]*")\]/g))
    if (isCode[found.index])
      places.push({
        kind: "key",
        start: found.index + 1,
        end: found.index + 1 + found[1].length,
        before: `${name}(`,
        after: ")",
      });
  return places;
}

function launderFile(text: string, isTypeScript: boolean, random: () => number) {
  const name = /\blaunder\b/.test(text) ? "launder$" : "launder";
  const all = findPlaces(text, name);
  if (all.length === 0) return text;
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const how = random();
  const kind = pick(all).kind;
  const one = pick(all);
  // One value, all of a kind, a third of all, or all.
  let chosen = all.filter(place =>
    how < 0.25 ? place === one : how < 0.5 ? place.kind === kind : how < 0.8 ? random() < 0.35 : true,
  );
  // A value inside a value that is handed through stays as it is: what is put in moves what lies behind it.
  chosen = chosen.filter(
    place =>
      !chosen.some(
        other => other !== place && other.start <= place.start && place.end <= other.end && other.end > other.start,
      ),
  );
  let result = text;
  for (const { start, end, before, after } of chosen.sort((a, b) => b.start - a.start))
    result = result.slice(0, start) + before + result.slice(start, end) + after + result.slice(end);
  const line = `const ${name} = new Function("value", process.argv[9] ?? "return value")${isTypeScript ? " as <V>(value: V) => V" : ""};\n`;
  const [front] = /^(?:(?:\/\/[^\n]*|#![^\n]*|["']use strict["'];?)\n)*/.exec(result)!;
  result = front + line + result.slice(front.length);
  try {
    new Bun.Transpiler({ loader: isTypeScript ? "ts" : "js" }).transformSync(result);
  } catch {
    return text;
  }
  return result;
}

/** `text` with some of its objects, functions, classes, texts, numbers and keys handed through a function that the build knows nothing about. */
export function launderValues(text: string, isTypeScript: boolean, random: () => number): string {
  return text
    .split(/^(?=\/\/ @filename: )/m)
    .map(file => {
      const name = /^\/\/ @filename: (\S+)/.exec(file)?.[1] ?? (isTypeScript ? ".ts" : ".js");
      if (!/\.[cm]?[jt]s$/.test(name) || /\.d\.[cm]?ts$/.test(name)) return file;
      return launderFile(file, /\.[cm]?ts$/.test(name), random);
    })
    .join("");
}
