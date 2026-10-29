// Small programs in which native code makes an object (`corners`: what makes it), and a function in the same file or in another one reads members of it that the program never stored.
//
//   made by    constructors of events, errors, requests, buffers, streams, collections; regular expressions and what they find; what the language makes for arguments, templates, descriptors, steps of iterators,
//              settled promises; Intl; JSON and clones; functions of node:path, node:url, node:util, node:querystring, node:fs, `process`
//   read       by a dot, in brackets, under a key out of a list, by a pattern; its kind, whether it is undefined, with a fallback; `in`, `Object.hasOwn`, the keys, the descriptor
//   where      straight, in a function without types, in a function whose parameter has a type; in the file that makes the object or in another one
//   beside it  nothing, a literal or an instance of a class of the program with a member of that name reaches the same function; or the object is an instance of a class of the program below the native one
//   typings    none (JavaScript); a declaration file that says `unknown`, `any`, or a number, a text or a boolean whatever the member is
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const node = (name: string) => `process.getBuiltinModule("node:${name}")`;
/** What makes the object, the members that are asked for, and the class that a class of the program can stand below. */
const makers: Record<string, readonly [make: string, members: string, base?: string]> = {
  "an event": [`new Event("kind")`, "isTrusted type bubbles cancelable defaultPrevented eventPhase target", "Event"],
  "an event with a detail": [`new CustomEvent("kind", { detail: 1 })`, "detail isTrusted type", "CustomEvent"],
  "a message event": [`new MessageEvent("kind", { data: 1 })`, "data origin isTrusted lastEventId", "MessageEvent"],
  "an error event": [`new ErrorEvent("kind", { message: "text" })`, "message isTrusted lineno error", "ErrorEvent"],
  "a close event": [`new CloseEvent("kind", { code: 5 })`, "code reason wasClean isTrusted", "CloseEvent"],
  "a copy of an event": [`{ ...new Event("kind") }`, "isTrusted type"],
  "an error": [`new Error("text")`, "message name cause", "Error"],
  "an error with a cause": [`new Error("text", { cause: 1 })`, "cause message", "Error"],
  "a type error": [`new TypeError("text")`, "message name", "TypeError"],
  "an error that native code throws": [
    "(() => {\n  try {\n    null.member;\n  } catch (error) {\n    return error;\n  }\n})()",
    "name cause",
  ],
  "an error of several": [`new AggregateError([1], "text")`, "errors message name", "AggregateError"],
  "an exception of the host": [`new DOMException("text", "AbortError")`, "name code message"],
  "what a regular expression finds": [`/(?<first>a)(b)?(c)?/d.exec("xab")`, "index input groups indices length 0 3"],
  "what match finds": [`"xab".match(/a(b)/)`, "index input groups length 1"],
  "what matchAll finds": [`[..."xab".matchAll(/a/g)][0]`, "index input groups length"],
  "the groups of a match": [`/(?<first>a)(?<second>c)?/.exec("xab").groups`, "first second third"],
  "a regular expression": ["/a/gi", "lastIndex source flags global sticky", "RegExp"],
  "a list": ["[1, 2]", "length 0 2", "Array"],
  "a list of a length": ["new Array(3)", "length 0", "Array"],
  "a text as an object": [`Object("ab")`, "length 0 2"],
  "arguments": ["(function () {\n  return arguments;\n})(1, 2)", "length 0 2"],
  "a function": ["function named(first, second) {}", "name length prototype"],
  "an arrow": ["() => 1", "name length prototype"],
  "a bound function": ["function named(first, second) {}.bind(null, 1)", "name length prototype"],
  "a class": ["class Named {\n  static member = 1;\n  constructor(first) {}\n}", "name length member prototype"],
  "a descriptor of a value": [
    `Object.getOwnPropertyDescriptor({ member: 1 }, "member")`,
    "value writable enumerable configurable get",
  ],
  "a descriptor of a getter": [
    `Object.getOwnPropertyDescriptor({ get member() {\n  return 1;\n} }, "member")`,
    "get set enumerable value",
  ],
  "a pair of Object.entries": ["Object.entries({ member: 1 })[0]", "0 1 length"],
  "a promise that was kept": ["(await Promise.allSettled([1]))[0]", "status value reason"],
  "a promise that was broken": ["(await Promise.allSettled([Promise.reject(2)]))[0]", "status reason value"],
  "Promise.withResolvers": ["Promise.withResolvers()", "promise resolve reject"],
  "a step of a list": ["[1][Symbol.iterator]().next()", "value done"],
  "a step of a generator": ["(function* () {\n  yield 1;\n})().next()", "value done"],
  "the last step of a generator": ["(function* () {})().next()", "value done"],
  "a step of a map": ["new Map([[1, 2]]).entries().next()", "value done"],
  "a step of an iterator helper": ["[1].values().map(each => each).next()", "value done"],
  "Proxy.revocable": ["Proxy.revocable({}, {})", "proxy revoke"],
  "the options of a number format": [
    `new Intl.NumberFormat("en").resolvedOptions()`,
    "locale numberingSystem style currency",
  ],
  "a part of a date": [`new Intl.DateTimeFormat("en", { timeZone: "UTC" }).formatToParts(0)[0]`, "type value"],
  "a segment": [`[...new Intl.Segmenter("en").segment("ab")][0]`, "segment index input isWordLike"],
  "a locale": [`new Intl.Locale("en-US")`, "language region baseName script"],
  "a clone": ["structuredClone({ first: 1, second: [2] })", "first second third"],
  "a clone of an error": [`structuredClone(new Error("text"))`, "message name cause"],
  "what JSON.parse makes": [`JSON.parse('{"first":1,"second":[2]}')`, "first second third"],
  "what Object.groupBy makes": [`Object.groupBy([1, 2], each => (each % 2 ? "odd" : "even"))`, "odd even none"],
  "what Object.fromEntries makes": [`Object.fromEntries([["first", 1]])`, "first second"],
  "the texts of a template": ["(texts => texts)`a${1}b`", "raw length 0"],
  "an address": [`new URL("http://host.test/path?key=1#part")`, "href host pathname search hash port", "URL"],
  "the parameters of an address": [`new URLSearchParams("key=1")`, "size"],
  "a request": [`new Request("http://host.test/", { method: "POST" })`, "method url bodyUsed redirect", "Request"],
  "a response": [`new Response("text", { status: 201 })`, "status ok statusText bodyUsed type", "Response"],
  "a response of JSON": ["Response.json({ member: 1 })", "status ok redirected"],
  "a blob": [`new Blob(["ab"], { type: "text/x" })`, "size type", "Blob"],
  "a file": [`new File(["ab"], "name.txt")`, "name size type", "File"],
  "a signal": ["new AbortController().signal", "aborted reason onabort"],
  "a signal that has fired": ["AbortSignal.abort(1)", "aborted reason"],
  "an encoder": ["new TextEncoder()", "encoding"],
  "what encodeInto answers": [`new TextEncoder().encodeInto("ab", new Uint8Array(4))`, "read written"],
  "a decoder": [`new TextDecoder("utf-8", { fatal: true })`, "encoding fatal ignoreBOM"],
  "a list of bytes": ["new Uint8Array(4)", "length byteLength byteOffset BYTES_PER_ELEMENT 0 4", "Uint8Array"],
  "a buffer that grows": [
    "new ArrayBuffer(8, { maxByteLength: 16 })",
    "byteLength maxByteLength resizable detached",
    "ArrayBuffer",
  ],
  "a view": ["new DataView(new ArrayBuffer(8), 2)", "byteLength byteOffset", "DataView"],
  "a buffer of node": [`Buffer.from("ab")`, "length byteLength byteOffset 0 2"],
  "a map": ["new Map([[1, 2]])", "size", "Map"],
  "a set": ["new Set([1])", "size", "Set"],
  "a symbol": [`Symbol("text")`, "description"],
  "a stream": ["new ReadableStream()", "locked"],
  "two streams": ["new TransformStream()", "readable writable"],
  "a mark": [`performance.mark("name", { detail: 1 })`, "name entryType detail duration"],
  "what waitAsync answers": ["Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(8)), 0, 1)", "async value"],
  "a parsed path": [`${node("path")}.parse("/folder/file.txt")`, "root dir base ext name"],
  "a parsed address": [`${node("url")}.parse("http://host.test/path?key=1")`, "protocol host pathname query href auth"],
  "parsed arguments": [
    `${node("util")}.parseArgs({ args: ["-a"], options: { a: { type: "boolean", short: "a" } } })`,
    "values positionals tokens",
  ],
  "a parsed query": [`${node("querystring")}.parse("first=1&second=2")`, "first second third"],
  "an emitter": [`new (${node("events")})()`, "_eventsCount _maxListeners domain"],
  "what stat answers": [`${node("fs")}.statSync(".")`, "nlink0 isDirectory"],
  "the release of the process": ["process.release", "name"],
};
export const corners = Object.keys(makers);

export function generate(
  random: Random,
  corner: string,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const [make, listed, base] = makers[corner];
  const members = random.sample(listed.split(" "), random.between(1, 3));
  const isAsync = make.includes("await");
  const where = random.weighted([
    [2, "straight"],
    [5, "a function"],
    [3, "a function in another file"],
  ] as const);
  const isMadeApart = random.chance(0.4);
  const beside = random.weighted([
    [5, "nothing"],
    [2, "a literal"],
    [2, "an instance"],
    [base ? 3 : 0, "a class below"],
  ] as const);
  const language = random.weighted([
    [5, "JavaScript"],
    [isMadeApart ? 5 : 0, "a declaration file"],
  ] as const);
  const said = random.pick(["unknown", "any", "number", "string", "boolean"]);
  const times = random.pick([1, 3, 3, 10000]);
  const isFresh = random.chance(0.7);
  const isTyped = language !== "JavaScript";

  const key = (member: string) => (/^\d+$/.test(member) ? `[${member}]` : `.${member}`);
  const quoted = (member: string) => JSON.stringify(member);
  const asked = members.map(member => ({
    member,
    how: random.pick([
      "a dot",
      "a dot",
      "brackets",
      "a key out of a list",
      "a pattern",
      "the kind",
      "whether it is undefined",
      "a fallback",
      "in",
      "hasOwn",
      "the keys",
      "the descriptor",
    ] as const),
  }));
  const shape = `{ ${members.map(member => `${/^\d+$/.test(member) ? member : member}: ${said}`).join("; ")} }`;
  const read = (holder: string, { member, how }: (typeof asked)[number]) =>
    ({
      "a dot": `${holder}${key(member)}`,
      "brackets": `${holder}[${quoted(member)}]`,
      "a key out of a list": `${isTyped ? `(${holder} as any)` : holder}[[${quoted(member)}, "none"][0]]`,
      "a pattern": `(({ ${/^\d+$/.test(member) ? `${member}: taken` : `${member}: taken`} }${isTyped ? `: ${shape}` : ""}) => taken)(${holder})`,
      "the kind": `typeof ${holder}${key(member)}`,
      "whether it is undefined": `${holder}${key(member)} === undefined`,
      "a fallback": `${holder}${key(member)} ?? "nothing"`,
      "in": `${quoted(member)} in Object(${holder})`,
      "hasOwn": `Object.hasOwn(Object(${holder}), ${quoted(member)})`,
      "the keys": `Object.keys(Object(${holder})).includes(${quoted(member)})`,
      "the descriptor": `Object.keys(Object.getOwnPropertyDescriptor(Object(${holder}), ${quoted(member)}) ?? {}).join()`,
    })[how];

  const script = isTyped ? "ts" : "mjs";
  const files: Record<string, string> = {};
  const below = beside === "a class below" ? `class Below extends ${base} {}\n` : "";
  const made = beside === "a class below" ? make.replace(new RegExp(`^new ${base}\\b`), "new Below") : make;
  const usesBelow = made !== make;
  const maker = `${usesBelow ? below : ""}export ${isAsync ? "async " : ""}function make() {\n  return ${made.startsWith("{") ? `(${made})` : made};\n}\n`;
  if (isMadeApart) {
    files["makes.mjs"] = maker;
    if (isTyped) files["makes.d.mts"] = `export declare function make(): ${isAsync ? `Promise<${shape}>` : shape};\n`;
  }
  const show = `function show(value${isTyped ? ": unknown" : ""}) {\n  return typeof value === "function" ? "function" : typeof value === "symbol" ? String(value) : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) + JSON.stringify(value) : typeof value + " " + String(value);\n}\n`;
  const getters = asked
    .map(
      (each, at) =>
        `export function get${at}(given${isTyped ? `: ${shape}` : ""}) {\n  return ${read("given", each)};\n}\n`,
    )
    .join("");
  if (where === "a function in another file") files[`reads.${script}`] = getters;
  const other =
    beside === "a literal"
      ? `{ ${members.map(member => `${member}: ${said === "string" ? `"mine"` : said === "boolean" ? "true" : "0.5"}`).join(", ")} }`
      : beside === "an instance"
        ? "new Mine()"
        : "";
  const mine =
    beside === "an instance"
      ? `class Mine {\n${members.map(member => `  ${member} = ${said === "string" ? `"mine"` : said === "boolean" ? "true" : "0.5"};\n`).join("")}}\n`
      : "";
  const call = isAsync ? "await make()" : "make()";
  const lines = asked
    .map((each, at) => {
      const ask = (holder: string) => (where === "straight" ? read(holder, each) : `get${at}(${holder})`);
      const one = isFresh ? call : "kept";
      return (
        (other && at % 2 === 0 ? `console.log("${each.member}, the other", show(${ask(other)}));\n` : "") +
        (times === 1
          ? `console.log("${each.member}, ${each.how}", show(${ask(one)}));\n`
          : times === 3
            ? `console.log("${each.member}, ${each.how}", show(${ask(one)}), show(${ask(one)}), show(${ask(one)}));\n`
            : `{\n  let last;\n  for (let turn = 0; turn < ${times}; turn++) last = ${ask("kept")};\n  console.log("${each.member}, ${each.how}", show(last));\n}\n`) +
        (other && at % 2 === 1 ? `console.log("${each.member}, the other", show(${ask(other)}));\n` : "")
      );
    })
    .join("");
  const text =
    (isMadeApart ? `import { make } from "./makes.mjs";\n` : "") +
    (where === "a function in another file"
      ? `import { ${asked.map((_, at) => `get${at}`).join(", ")} } from "./reads${isTyped ? "" : ".mjs"}";\n`
      : "") +
    (isMadeApart ? "" : maker.replace("export ", "")) +
    show +
    (where === "a function" ? getters.replaceAll("export function", "function") : "") +
    mine +
    `const kept = ${call};\n` +
    lines +
    "export {};\n";
  if (isTyped)
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            strict: true,
            types: [],
          },
        },
        null,
        2,
      ) + "\n";
  return { file: `main.${script}`, text, files };
}
