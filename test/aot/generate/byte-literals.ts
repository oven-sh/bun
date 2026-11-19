// The programs of byte-literals that are a table written out: every way to make bytes out of constants, over awkward inputs.
// Each call has its arguments written in the source, because a loop over a table of inputs would hide them from the compiler.
// Each call site prints its bytes, their offset in the buffer, and the class of the result. It also runs three times, to show that no two results share memory.
//
//   bun test/aot/generate.ts byte-literals <where>         writes the whole table
//   bun test/aot/generate/byte-literals.ts <where>         writes the subset stored under test/aot/parallel/byte-literals
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { programsOf } from "../generate";

type Input = [name: string, input: string, isStored?: boolean];

/** A double-quoted literal. Whole characters are written as they are. Control characters, lone surrogates and characters that editors hide are escaped. */
export function literal(input: string): string {
  const escaped = (unit: number, digits: number) => unit.toString(16).padStart(digits, "0");
  let written = '"';
  for (let index = 0; index < input.length; index++) {
    const unit = input.charCodeAt(index);
    const next = index + 1 < input.length ? input.charCodeAt(index + 1) : 0;
    if (unit === 0x22) written += '\\"';
    else if (unit === 0x5c) written += "\\\\";
    else if (unit === 0x0a) written += "\\n";
    else if (unit === 0x0d) written += "\\r";
    else if (unit === 0x09) written += "\\t";
    else if (unit < 0x20 || (unit >= 0x7f && unit <= 0xa0)) written += "\\x" + escaped(unit, 2);
    else if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) written += input[index] + input[++index];
    else if ((unit >= 0xd800 && unit <= 0xdfff) || unit === 0x2028 || unit === 0x2029 || unit >= 0xfeff) written += "\\u" + escaped(unit, 4);
    else written += input[index];
  }
  return written + '"';
}

const prelude = (isTyped: boolean) => {
  const bytes = isTyped ? ": Uint8Array" : "";
  const stringType = isTyped ? ": string" : "";
  return `function hashOf(bytes${bytes}) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index++) hash = Math.imul(hash ^ bytes[index], 16777619);
  return (hash >>> 0).toString(16);
}
function hexOf(bytes${bytes}) {
  let hex = "";
  const shown = Math.min(bytes.length, 40);
  for (let index = 0; index < shown; index++) hex += (bytes[index] < 16 ? "0" : "") + bytes[index].toString(16);
  return bytes.length > shown ? hex + ".." : hex;
}
function prototypeOf(value${isTyped ? ": object" : ""}) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Buffer.prototype ? "Buffer.prototype" : prototype === Uint8Array.prototype ? "Uint8Array.prototype" : "another prototype";
}
function describe(bytes${bytes}) {
  return [
    "[" + hexOf(bytes) + "]",
    hashOf(bytes),
    "offset " + bytes.byteOffset,
    "of " + bytes.buffer.byteLength,
    "length " + bytes.length,
    prototypeOf(bytes),
    bytes.constructor.name,
    Buffer.isBuffer(bytes) ? "is a Buffer" : "is no Buffer",
    Object.prototype.toString.call(bytes),
    "part: " + prototypeOf(bytes.subarray(0, 1)),
  ].join(" | ");
}
function show(label${stringType}, make${isTyped ? ": () => Uint8Array" : ""}) {
  try {
    const first = make();
    const described = describe(first);
    const second = make();
    for (let index = 0; index < first.length; index++) first[index] ^= 0xa5;
    const third = make();
    const areIndependent = first !== second && first.buffer !== second.buffer && describe(second) === described && describe(third) === described;
    console.log(label, "|", described, "|", areIndependent ? "independent" : "SHARED");
  } catch (error${isTyped ? ": any" : ""}) {
    console.log(label, "| throws", error.name, "|", error.code, "|", error.message);
  }
}
`;
};

type Site = { source: string; isEncoded: boolean };

const stringLiteral = String.raw`"(?:[^"\\]|\\.)*"`;
const encodedForms = new RegExp(`^(?:Buffer\\.from\\(${stringLiteral}(?:, ${stringLiteral})?\\)|Uint8Array\\.from(?:Base64|Hex)\\(${stringLiteral}\\))$`);

/** Whether the compiler encodes the call at build time: it is one of these forms, its arguments are string literals, and it does not throw. */
function isEncodedAtBuild(call: string): boolean {
  if (!encodedForms.test(call)) return false;
  try {
    new Function(`return ${call};`)();
    return true;
  } catch {
    return false;
  }
}

/** Holds the build to the number of call sites that it encodes. 0 shows that it left every call as written. */
const statistic = (encoded: number) => `// STATISTIC: ByteLiteralsEncoded = ${encoded}`;
/** For a program written by hand: the number is what a build counted. It counts compiled copies, so a call in a function that is inlined or compiled twice counts more than once. */
const withStatistic = (encoded: number, source: string) => source.replace("\n", `\n${statistic(encoded)}\n`);

const program = (firstLine: string, isTyped: boolean, sites: Site[]) =>
  `// ${firstLine}\n${statistic(sites.filter(site => site.isEncoded).length)}\n${prelude(isTyped)}${sites.map(site => site.source).join("\n")}\n${isTyped ? "export {};\n" : ""}`;
const site = (label: string, call: string): Site => ({ source: `show(${JSON.stringify(label)}, () => ${call});`, isEncoded: isEncodedAtBuild(call) });
const statement = (source: string): Site => ({ source, isEncoded: false });

const strings: Input[] = [
  ["empty", "", true],
  ["one letter", "a"],
  ["ASCII", "hello, world", true],
  ["NUL alone", "\0", true],
  ["NUL inside", "a\0b"],
  ["quotes and escapes", "\"\\\n\r\t'`${x}"],
  ["e acute", "\xe9", true],
  ["y diaeresis", "\xff"],
  ["Latin-1 words", "caf\xe9 na\xefve \xff"],
  ["C1 controls and no-break space", "\x80\x9f\xa0"],
  ["euro sign", "\u20ac"],
  ["CJK", "\u4e2d\u6587"],
  ["every UTF-8 length", "a\xe9\u20ac\u{1f600}", true],
  ["UTF-8 length boundaries", "\x7f\x80\u07ff\u0800\uffff"],
  ["astral", "\u{1f600}"],
  ["two astral", "\u{1f600}\u{10ffff}"],
  ["lone lead", "\ud83d"],
  ["lone lead at the start", "\ud83dabc"],
  ["lone lead in the middle", "ab\ud83dcd", true],
  ["lone lead at the end", "abc\ud83d"],
  ["lone trail", "\ude00"],
  ["lone trail at the start", "\ude00abc"],
  ["lone trail in the middle", "ab\ude00cd"],
  ["lone trail at the end", "abc\ude00", true],
  ["trail before lead", "\ude00\ud83d", true],
  ["lead before a pair", "\ud83d\ud83d\ude00"],
  ["pair before a trail", "\ud83d\ude00\ude00"],
  ["lead before Latin-1", "\ud83d\xe9"],
  ["byte order mark", "\ufeffabc"],
  ["replacement character", "\ufffd"],
  ["low bytes spell ASCII", "\u0161\u0162\u0163", true],
  ["hex digits", "68656c6c6f", true],
  ["base64 characters", "aGVsbG8=", true],
];

const encodings = ["utf8", "utf-8", "latin1", "binary", "ascii", "hex", "base64", "base64url", "ucs2", "ucs-2", "utf16le", "utf-16le"];
const mixedCase = (name: string) => [...name].map((letter, index) => (index % 2 ? letter : letter.toUpperCase())).join("");

const hexStrings: Input[] = [
  ["empty", "", true],
  ["one digit", "6"],
  ["one pair", "68"],
  ["odd length", "686", true],
  ["five pairs", "68656c6c6f", true],
  ["upper case", "68656C6C6F", true],
  ["mixed case", "68656c6C6f"],
  ["bad pair at the start", "zz6865"],
  ["bad pair in the middle", "68zz65", true],
  ["bad pair at the end", "6865zz", true],
  ["bad second digit", "686g65", true],
  ["bad first digit", "68g665"],
  ["space in the middle", "68 65"],
  ["space at the start", " 6865"],
  ["space at the end", "6865 "],
  ["0x prefix", "0x6865"],
  ["newline", "68\n65"],
  ["signs", "-1+f"],
  ["Latin-1 at the end", "6865\xe9"],
  ["Latin-1 pair at the start", "\xe9\xe96865"],
  ["CJK in the middle", "68\u4e2d\u4e2d65", true],
  ["fullwidth digits", "\uff16\uff18"],
  ["low bytes spell digits", "\u0136\u013865", true],
  ["zeros and ones", "00ff00FF"],
  ["NUL", "68\0\x0065"],
];

const base64Strings: Input[] = [
  ["empty", "", true],
  ["one character", "a", true],
  ["two characters", "aG"],
  ["three characters", "aGk", true],
  ["padded", "aGk="],
  ["padded twice too often", "aGk===", true],
  ["hello padded", "aGVsbG8="],
  ["hello without padding", "aGVsbG8", true],
  ["hello with extra padding", "aGVsbG8=="],
  ["space inside", "aGVs bG8="],
  ["newline inside", "aGVs\nbG8=", true],
  ["whitespace around", "\t aGVsbG8=\r\n", true],
  ["vertical tab inside", "aGVs\x0bbG8="],
  ["form feed inside", "aGVs\x0cbG8="],
  ["standard alphabet", "+/+/"],
  ["URL alphabet", "-_-_"],
  ["both alphabets", "+/-_", true],
  ["both alphabets among letters", "a+b/c-d_"],
  ["invalid character inside", "aGVs*bG8=", true],
  ["several invalid characters", "a.G,V;s"],
  ["padding inside", "aGVs=bG8=", true],
  ["padding first", "=aGVs"],
  ["only padding", "====", true],
  ["one padding", "="],
  ["two strings joined", "aGVsbG8=aGVsbG8="],
  ["Latin-1 at the end", "aGVsbG8\xe9"],
  ["CJK inside", "aGVs\u4e2dbG8=", true],
  ["low byte spells a letter", "\u0161GVsbG8="],
  ["low byte spells padding", "aGk\u013d", true],
  ["all slashes", "////"],
  ["zero bits", "AAAA"],
  ["one byte", "AA=="],
  ["one byte with one padding", "AA=", true],
  ["nonzero spare bits", "AB==", true],
  ["nonzero spare bits without padding", "AB"],
  ["six bytes", "Zm9vYmFy"],
  ["five bytes without padding", "Zm9vYmE"],
  ["data URL", "data:text/plain;base64,aGk="],
  ["NUL inside", "aGVs\0bG8="],
];

const base64Options = [
  "",
  ', { alphabet: "base64" }',
  ', { alphabet: "base64url" }',
  ', { lastChunkHandling: "loose" }',
  ', { lastChunkHandling: "strict" }',
  ', { lastChunkHandling: "stop-before-partial" }',
  ', { alphabet: "base64url", lastChunkHandling: "strict" }',
];

const stored = (inputs: Input[], onlyStored: boolean) => (onlyStored ? inputs.filter(input => input[2]) : inputs);

function bufferFromEveryEncoding(onlyStored: boolean): string {
  const sites: Site[] = [];
  for (const [name, input] of stored(strings, onlyStored)) {
    sites.push(site(`${name}, no encoding`, `Buffer.from(${literal(input)})`));
    for (const encoding of encodings) sites.push(site(`${name}, ${encoding}`, `Buffer.from(${literal(input)}, "${encoding}")`));
  }
  return program("Buffer.from with a literal string and a literal encoding gives the bytes that plain Bun gives.", true, sites);
}

function encodingNameSpellings(onlyStored: boolean): string {
  const sites: Site[] = [];
  const few: Input[] = [
    ["ASCII", "hello"],
    ["every UTF-8 length", "a\xe9\u20ac\u{1f600}", true],
    ["hex digits", "68656c6c6f"],
  ];
  for (const [name, input] of stored(few, onlyStored)) {
    for (const encoding of encodings)
      for (const spelling of [encoding, encoding.toUpperCase(), mixedCase(encoding)])
        sites.push(site(`${name}, ${spelling}`, `Buffer.from(${literal(input)}, "${spelling}")`));
    for (const unknown of ["nope", "", "utf9", "utf 8", "utf8 ", " utf8", "utf_8", "utf16", "utf-16", "ucs-4", "base-64", "buffer", "BUFFER", "latin-1", "us-ascii", "\u0131tf8", "utf8\0"])
      sites.push(site(`${name}, unknown ${JSON.stringify(unknown)}`, `Buffer.from(${literal(input)}, ${literal(unknown)})`));
    for (const other of ["undefined", "null", "1", "0", "true", "false", "NaN", "{}", "[]", '["hex"]', "Symbol.iterator", "1n", "() => 1", "void 0"])
      sites.push(site(`${name}, encoding ${other}`, `Buffer.from(${literal(input)}, ${other})`));
    sites.push(site(`${name}, three arguments`, `Buffer.from(${literal(input)}, "latin1", 2)`));
    sites.push(site(`${name}, a length and no encoding`, `Buffer.from(${literal(input)}, undefined, 2)`));
  }
  return program("An encoding's name is matched in any letter case, an unknown name throws, and an encoding that is not a string means UTF-8.", false, sites);
}

function hexStringProgram(onlyStored: boolean): string {
  const sites: Site[] = [];
  for (const [name, input] of stored(hexStrings, onlyStored)) {
    sites.push(site(`${name}, Buffer.from`, `Buffer.from(${literal(input)}, "hex")`));
    sites.push(site(`${name}, Uint8Array.fromHex`, `Uint8Array.fromHex(${literal(input)})`));
  }
  return program("Buffer.from stops at the first bad pair of hex digits, and Uint8Array.fromHex throws.", true, sites);
}

function base64StringProgram(onlyStored: boolean): string {
  const sites: Site[] = [];
  for (const [name, input] of stored(base64Strings, onlyStored)) {
    sites.push(site(`${name}, Buffer.from base64`, `Buffer.from(${literal(input)}, "base64")`));
    sites.push(site(`${name}, Buffer.from base64url`, `Buffer.from(${literal(input)}, "base64url")`));
    for (const options of onlyStored ? [base64Options[0], base64Options[2], base64Options[4]] : base64Options)
      sites.push(site(`${name}, Uint8Array.fromBase64${options}`, `Uint8Array.fromBase64(${literal(input)}${options})`));
  }
  return program("Buffer.from reads base64 leniently, and Uint8Array.fromBase64 reads it as its options say.", true, sites);
}

function fromBase64Options(): string {
  const sites: Site[] = [];
  for (const options of ["undefined", "null", "1", '"base64url"', "{}", '{ alphabet: "nope" }', '{ lastChunkHandling: "nope" }', "{ alphabet: undefined }", "{ alphabet: 1 }", '{ get alphabet() { console.log("alphabet is read"); return "base64url"; } }', '{ get lastChunkHandling() { console.log("lastChunkHandling is read"); return "strict"; }, get alphabet() { console.log("alphabet is read"); return "base64"; } }', 'Object.create({ alphabet: "base64url" })'])
    for (const input of ["-_-_", "+/+/", "AA="]) sites.push(site(`${input}, options ${options}`, `Uint8Array.fromBase64(${literal(input)}, ${options})`));
  for (const argument of ["undefined", "null", "1", "{}", '["aGk="]', 'new String("aGk=")', '{ toString() { return "aGk="; } }']) {
    sites.push(site(`fromBase64 of ${argument}`, `Uint8Array.fromBase64(${argument})`));
    sites.push(site(`fromHex of ${argument}`, `Uint8Array.fromHex(${argument})`));
  }
  sites.push(site("fromBase64 of nothing", "Uint8Array.fromBase64()"));
  sites.push(site("fromHex of nothing", "Uint8Array.fromHex()"));
  sites.push(site("fromHex with a second argument", 'Uint8Array.fromHex("6869", { alphabet: "base64url" })'));
  return program("Uint8Array.fromBase64 reads its options in order, refuses the ones it does not know, and takes nothing but a string.", false, sites);
}

function textEncoderStrings(onlyStored: boolean): string {
  const sites: Site[] = [statement("const sharedEncoder = new TextEncoder();")];
  for (const [name, input] of stored(strings, onlyStored)) {
    sites.push(site(`${name}, a new encoder`, `new TextEncoder().encode(${literal(input)})`));
    sites.push(site(`${name}, a shared encoder`, `sharedEncoder.encode(${literal(input)})`));
  }
  return program("TextEncoder.prototype.encode with a literal string gives the bytes that plain Bun gives.", true, sites);
}

function textEncoderNonStrings(): string {
  const sites: Site[] = [statement("const sharedEncoder = new TextEncoder();")];
  for (const argument of ["", "undefined", "null", "1", "1.5", "-0", "true", "1n", "{}", "[]", '["a", "b"]', 'new String("boxed")', '{ toString() { return "converted"; } }', "Symbol.iterator", '"two", "arguments"'])
    for (const encoder of ["new TextEncoder()", "sharedEncoder", 'new TextEncoder("utf-16le")']) sites.push(site(`${encoder} encodes (${argument})`, `${encoder}.encode(${argument})`));
  return program("TextEncoder.prototype.encode converts a constant that is not a string as plain Bun does.", false, sites);
}

function longLiterals(lengths: number[]): string {
  const sites: Site[] = [];
  const cycle = (alphabet: string, length: number) => {
    const units = [...alphabet];
    let input = "";
    for (let index = 0; index < length; index++) input += units[(index * 7 + (index >> 5)) % units.length];
    return input;
  };
  for (const length of lengths) {
    const ascii = literal(cycle("abcdefghijklmnopqrstuvwxyz0123456789 ,.", length));
    const latin1 = literal(cycle("ab\xe9\xff\xe0cd", length));
    const wide = literal(cycle("ab\u20ac\u4e2d\xe9", length));
    const astral = literal(cycle("a\u{1f600}\u20ac", length));
    const hex = literal(cycle("0123456789abcdefABCDEF", 2 * length));
    const base64 = literal(cycle("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", Math.ceil((length * 4) / 3)));
    sites.push(site(`${length} ASCII, no encoding`, `Buffer.from(${ascii})`));
    sites.push(site(`${length} ASCII, latin1`, `Buffer.from(${ascii}, "latin1")`));
    sites.push(site(`${length} ASCII, utf16le`, `Buffer.from(${ascii}, "utf16le")`));
    sites.push(site(`${length} ASCII, TextEncoder`, `new TextEncoder().encode(${ascii})`));
    sites.push(site(`${length} Latin-1, utf8`, `Buffer.from(${latin1}, "utf8")`));
    sites.push(site(`${length} Latin-1, latin1`, `Buffer.from(${latin1}, "latin1")`));
    sites.push(site(`${length} Latin-1, ascii`, `Buffer.from(${latin1}, "ascii")`));
    sites.push(site(`${length} Latin-1, TextEncoder`, `new TextEncoder().encode(${latin1})`));
    sites.push(site(`${length} wide, utf8`, `Buffer.from(${wide})`));
    sites.push(site(`${length} wide, latin1`, `Buffer.from(${wide}, "latin1")`));
    sites.push(site(`${length} wide, ucs2`, `Buffer.from(${wide}, "ucs2")`));
    sites.push(site(`${length} wide, TextEncoder`, `new TextEncoder().encode(${wide})`));
    sites.push(site(`${length} with astral, utf8`, `Buffer.from(${astral})`));
    sites.push(site(`${length} with astral, TextEncoder`, `new TextEncoder().encode(${astral})`));
    sites.push(site(`${length} bytes of hex, Buffer.from`, `Buffer.from(${hex}, "hex")`));
    sites.push(site(`${length} bytes of hex, Uint8Array.fromHex`, `Uint8Array.fromHex(${hex})`));
    sites.push(site(`${length} bytes of base64, Buffer.from`, `Buffer.from(${base64}, "base64")`));
    sites.push(site(`${length} bytes of base64, Uint8Array.fromBase64`, `Uint8Array.fromBase64(${base64})`));
  }
  return program("Long literals give the same bytes and buffers as in plain Bun, below and above the size limit of a typed array with inline storage.", true, sites);
}

const numberArrays: [name: string, elements: string, isStored?: boolean][] = [
  ["nothing", "", true],
  ["zero", "0"],
  ["small integers", "1, 2, 3", true],
  ["around 256", "255, 256, 257, 511, 512", true],
  ["negative integers", "-1, -128, -129, -255, -256, -257", true],
  ["fractions", "1.5, 2.9, -1.5, 0.1, -0.9, 255.9, 256.5", true],
  ["not finite", "NaN, Infinity, -Infinity", true],
  ["negative zero", "-0"],
  ["beyond 32 bits", "1e10, 4294967295, 4294967296, 4294967297, 9007199254740992, -4294967297", true],
  ["around the largest int32", "2147483647, 2147483648, -2147483648, -2147483649"],
  ["huge and tiny", "1e308, -1e308, 5e-324, 1e21"],
  ["constant expressions", "1 + 1, 2 ** 8 + 1, 7 & 3, ~0, 1 << 9", true],
  ["hex, octal and binary literals", "0xff, 0o17, 0b101, 1_000"],
  ["booleans and null", "true, false, null", true],
  ["undefined", "undefined, void 0", true],
  ["numeric strings", '"1", "0x10", " 12 ", "", "x", "1e3"', true],
  ["a BigInt", "1, 2n", true],
  ["a symbol", "1, Symbol.iterator"],
  ["an object that converts", '1, { valueOf() { console.log("valueOf runs"); return 7; } }, 3', true],
  ["nested arrays", "[5], [], [1, 2]"],
];

function constantNumbers(onlyStored: boolean): string {
  const sites: Site[] = [];
  for (const [name, elements] of onlyStored ? numberArrays.filter(array => array[2]) : numberArrays) {
    sites.push(site(`${name}, Buffer.from`, `Buffer.from([${elements}])`));
    sites.push(site(`${name}, new Uint8Array`, `new Uint8Array([${elements}])`));
    sites.push(site(`${name}, Uint8Array.of`, `Uint8Array.of(${elements})`));
    sites.push(site(`${name}, Uint8Array.from`, `Uint8Array.from([${elements}])`));
    sites.push(site(`${name}, Buffer.of`, `Buffer.of(${elements})`));
  }
  sites.push(site("a hole, Buffer.from", "Buffer.from([1, , 3])"));
  sites.push(site("a hole, new Uint8Array", "new Uint8Array([1, , 3])"));
  sites.push(site("a trailing hole, new Uint8Array", "new Uint8Array([1, 2, ,])"));
  sites.push(site("a spread of constants, new Uint8Array", "new Uint8Array([...[1, 2], 3])"));
  sites.push(site("a spread of constants, Uint8Array.of", "Uint8Array.of(...[1, 2], 3)"));
  sites.push(site("another element type, Int8Array", "new Int8Array([127, 128, 255, -129])"));
  sites.push(site("another element type, Uint8ClampedArray", "new Uint8ClampedArray([-1, 0.5, 1.5, 255, 256, NaN])"));
  sites.push(site("another element type, Uint16Array", "new Uint16Array([1, 65536, -1])"));
  for (const length of onlyStored ? [1001] : [999, 1000, 1001, 5000]) {
    const elements = Array.from({ length }, (_, index) => (index * 37) % 300).join(", ");
    sites.push(site(`${length} elements, Buffer.from`, `Buffer.from([${elements}])`));
    sites.push(site(`${length} elements, new Uint8Array`, `new Uint8Array([${elements}])`));
    if (length <= 1001) sites.push(site(`${length} elements, Uint8Array.of`, `Uint8Array.of(${elements})`));
  }
  return program("Bytes made of constant numbers wrap as in plain Bun, and elements that are not numbers are converted in order.", false, sites);
}

const indirectConstants = `// A constant reaches the call through a const binding, a folded concatenation, a template, an import, a helper function or a loop.
import { Buffer as ImportedBuffer } from "node:buffer";
import * as bufferModule from "node:buffer";
import { TextEncoder as ImportedTextEncoder } from "node:util";
${prelude(true)}const constString = "bound to a const \\xe9\\u20ac";
const constEncoding = "latin1";
const constHex = "68656c" + "6c6f";
const constNumbers = [1, 2, 300];
let reassigned = "first";
const from = Buffer.from;
const BufferUnderAnotherName = Buffer;
const encoderAtTopLevel = new TextEncoder();
const atTopLevel = Buffer.from("at top level \\ud83d");
const atTopLevelWithEncoding = Buffer.from("YXQgdG9wIGxldmVs", "base64");
const encodedAtTopLevel = new TextEncoder().encode("at top level \\ude00");
const fromHexAtTopLevel = Uint8Array.fromHex("746f70");
const numbersAtTopLevel = new Uint8Array([1, 2, 3]);
console.log("top level |", describe(atTopLevel));
console.log("top level, base64 |", describe(atTopLevelWithEncoding));
console.log("top level, TextEncoder |", describe(encodedAtTopLevel));
console.log("top level, fromHex |", describe(fromHexAtTopLevel));
console.log("top level, numbers |", describe(numbersAtTopLevel));

function bytesOf(input: string) {
  return Buffer.from(input);
}
function bytesIn(input: string, encoding: BufferEncoding) {
  return Buffer.from(input, encoding);
}
function encoded(input: string) {
  return new TextEncoder().encode(input);
}
function withDefault(input = "the default", encoding: BufferEncoding = "utf16le") {
  return Buffer.from(input, encoding);
}
const arrow = (input: string) => Uint8Array.fromBase64(input);

show("a const string", () => Buffer.from(constString));
show("a const string and a const encoding", () => Buffer.from(constString, constEncoding));
show("a const made of a concatenation", () => Buffer.from(constHex, "hex"));
show("a concatenation in the call", () => Buffer.from("con" + "cat" + "enated"));
show("a concatenation of a const and a literal", () => Buffer.from(constString + " and more", ("utf" + "8") as BufferEncoding));
show("a concatenation with a number", () => Buffer.from("n" + 1 + 2.5 + true + null));
show("a template without substitutions", () => Buffer.from(\`a template \\xe9\`));
show("a template of constants", () => Buffer.from(\`\${constString}/\${1 + 1}\`));
show("a conditional on a constant", () => Buffer.from(true ? "taken" : "not taken"));
show("a parenthesized literal with a cast", () => Buffer.from(("cast" as string), "latin1" as BufferEncoding));
show("a method of a literal", () => Buffer.from("upper".toUpperCase()));
show("a repeated literal", () => Buffer.from("ab".repeat(3), "utf16le"));
show("String.fromCharCode of constants", () => Buffer.from(String.fromCharCode(0xd83d, 0x61)));
show("a const array of numbers", () => Buffer.from(constNumbers));
show("a const array of numbers, new Uint8Array", () => new Uint8Array(constNumbers));
show("an imported Buffer", () => ImportedBuffer.from("imported \\u4e2d", "utf8"));
show("a Buffer off the module's namespace", () => bufferModule.Buffer.from("namespace", "hex"));
show("an imported TextEncoder", () => new ImportedTextEncoder().encode("imported \\ud83d"));
show("globalThis.Buffer", () => globalThis.Buffer.from("off globalThis"));
show("Buffer under another name", () => BufferUnderAnotherName.from("another name", "ascii"));
show("from, detached", () => from("detached"));
show("an encoder made at top level", () => encoderAtTopLevel.encode("encoder at top level"));
show("a helper with a literal", () => bytesOf("through a helper \\ud83d\\ude00"));
show("a helper with another literal", () => bytesOf("through the same helper"));
show("a helper with a literal and an encoding", () => bytesIn("aGVscGVy", "base64"));
show("a helper with a literal and another encoding", () => bytesIn("68656c706572", "hex"));
show("a helper around TextEncoder", () => encoded("through a helper \\ude00"));
show("an arrow around fromBase64", () => arrow("YXJyb3c="));
show("default parameters", () => withDefault());
show("one default parameter", () => withDefault("given"));
function reassignedBetweenCalls() {
  const before = Buffer.from(reassigned);
  reassigned = "second";
  return hexOf(before) + " " + hexOf(Buffer.from(reassigned));
}
console.log("a variable that is reassigned |", reassignedBetweenCalls(), "|", reassignedBetweenCalls());

let sum = 0;
for (let iteration = 0; iteration < 5; iteration++) {
  const inLoop = Buffer.from("in a loop");
  sum += inLoop[iteration];
  inLoop[iteration + 1] = 0;
  const encodedInLoop = new TextEncoder().encode("\\u20ac in a loop");
  sum += encodedInLoop[iteration];
  encodedInLoop[iteration + 1] = 0;
  const numbersInLoop = new Uint8Array([9, 8, 7, 6, 5, 4]);
  sum += numbersInLoop[iteration];
  numbersInLoop[iteration + 1] = 0;
}
console.log("loops |", sum);

function kept() {
  const all: Uint8Array[] = [];
  for (let iteration = 0; iteration < 4; iteration++) all.push(Buffer.from("kept", "latin1"));
  all[0][0] = 1;
  all[1][1] = 2;
  all[2].fill(3);
  return all.map(hexOf).join(" ");
}
console.log("kept across iterations |", kept());

function grown() {
  const bytes = Buffer.from("grown");
  (bytes as any).extra = "a property of its own";
  return [Object.keys(bytes).join(","), (Buffer.from("grown") as any).extra].join(" | ");
}
console.log("a property on one result |", grown());

function transferred() {
  const bytes = Buffer.from("transferred");
  const moved = bytes.buffer.transfer(4);
  return [bytes.length, moved.byteLength, hexOf(new Uint8Array(moved)), hexOf(Buffer.from("transferred"))].join(" | ");
}
console.log("a buffer that is transferred |", transferred());

async function acrossAwait() {
  const before = Buffer.from("before await");
  await null;
  const after = new TextEncoder().encode("after await");
  return hexOf(before) + " " + hexOf(after);
}
console.log("across an await |", await acrossAwait());

function* acrossYield() {
  yield Buffer.from("first yield", "utf16le");
  yield Uint8Array.fromHex("7969656c64");
}
console.log("across a yield |", [...acrossYield()].map(hexOf).join(" "));

class Example {
  static bytes = Buffer.from("a static field");
  field = new TextEncoder().encode("a field");
  method() {
    return Buffer.from("a method", "ascii");
  }
}
console.log("in a class |", hexOf(Example.bytes), hexOf(new Example().field), hexOf(new Example().method()), new Example().field !== new Example().field);
`;

const lockedStore = "warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable";
const storeUnderHiddenName =
  "warn: TS100014: the compiler can't read the property name here. This assignment throws if the name is an existing member, or one that compiled code relies on being absent: a compiled executable keeps both as they are on built-in objects";

type Replacement = {
  name: string;
  firstLine: string;
  /** How many call sites a build encodes. */
  encoded: number;
  /** What the program evaluates before and after each attempt. It gives a string. */
  expression: string;
  /** Statements before everything else. */
  setup?: string;
  /** Each statement runs in order, and `expression` is printed after each. */
  attempts: [label: string, statement: string][];
  /** Set where a compiled executable keeps the built-in: what the build prints and what the executable prints. Otherwise the program prints what plain Bun prints. */
  locked?: { buildPrints: string[]; output: string[] };
};

const replacements: Replacement[] = [
  {
    name: "replaced-global-buffer.js",
    firstLine: "A program that stores another object into globalThis.Buffer finds it under the free name.",
    encoded: 0,
    expression: 'String(Buffer.from("literal", "latin1"))',
    setup: "const original = Buffer;",
    attempts: [
      ["stored", 'globalThis.Buffer = { from: (input, encoding) => "the replacement got " + input + " " + encoding };'],
      ["restored", "globalThis.Buffer = original;"],
    ],
  },
  {
    name: "replaced-global-text-encoder.js",
    firstLine: "A program that stores another class into globalThis.TextEncoder constructs that class.",
    encoded: 0,
    expression: 'String(new TextEncoder().encode("hi"))',
    attempts: [["stored", 'globalThis.TextEncoder = class { encode(input) { return "the replacement got " + input; } };']],
  },
  {
    name: "locked-global-uint8array.js",
    firstLine: "A compiled executable keeps globalThis.Uint8Array, so the free name goes on naming the built-in.",
    encoded: 2,
    expression: '[String(Uint8Array.fromBase64("aGk=")), String(Uint8Array.fromHex("6869")), String(Uint8Array.of(1, 2))].join(" | ")',
    attempts: [["stored", 'globalThis.Uint8Array = { fromBase64: input => "base64 " + input, fromHex: input => "hex " + input, of: (...numbers) => "of " + numbers };']],
    locked: { buildPrints: [`1 x ${lockedStore}`], output: ["before | 104,105 | 104,105 | 1,2", "stored throws TypeError", "then | 104,105 | 104,105 | 1,2"] },
  },
  {
    name: "replaced-encode.js",
    firstLine: "A program that stores another function into TextEncoder.prototype.encode calls that function from then on.",
    encoded: 0,
    expression: '[String(new TextEncoder().encode("hi")), String(shared.encode("hi"))].join(" | ")',
    setup: "const shared = new TextEncoder();\nconst original = TextEncoder.prototype.encode;",
    attempts: [
      ["stored", 'TextEncoder.prototype.encode = function (input) { return "the replacement got " + input; };'],
      ["restored", "TextEncoder.prototype.encode = original;"],
    ],
  },
  {
    name: "redefined-encode.js",
    firstLine: "A program that defines TextEncoder.prototype.encode anew calls what it defined.",
    encoded: 0,
    expression: '[String(new TextEncoder().encode("hi")), String(shared.encode("hi"))].join(" | ")',
    setup: "const shared = new TextEncoder();",
    attempts: [["defined", 'Object.defineProperty(TextEncoder.prototype, "encode", { value: input => "the replacement got " + input });']],
  },
  {
    name: "replaced-encode-hidden-name.js",
    firstLine: "A program that stores into TextEncoder.prototype under a name that the build cannot read calls what it stored.",
    encoded: 0,
    expression: '[String(new TextEncoder().encode("hi")), String(shared.encode("hi"))].join(" | ")',
    setup: 'const shared = new TextEncoder();\nconst name = JSON.parse(\'"encode"\');',
    attempts: [["stored", 'TextEncoder.prototype[name] = input => "the replacement got " + input;']],
  },
  {
    name: "own-encode-property.js",
    firstLine: "An encoder with an own property named encode, or with another prototype, calls that function.",
    encoded: 0,
    expression: 'String(shared.encode("hi"))',
    setup: "const shared = new TextEncoder();",
    attempts: [
      ["an own property", 'shared.encode = input => "the own property got " + input;'],
      ["deleted again", "delete shared.encode;"],
      ["another prototype", 'Object.setPrototypeOf(shared, { encode: input => "another prototype got " + input });'],
    ],
  },
  {
    name: "replaced-from-base64.js",
    firstLine: "A program that stores another function into Uint8Array.fromBase64 calls that function from then on.",
    encoded: 0,
    expression: 'String(Uint8Array.fromBase64("aGk="))',
    setup: "const original = Uint8Array.fromBase64;",
    attempts: [
      ["stored", 'Uint8Array.fromBase64 = input => "the replacement got " + input;'],
      ["restored", "Uint8Array.fromBase64 = original;"],
    ],
  },
  {
    name: "replaced-from-hex.js",
    firstLine: "A program that stores another function into Uint8Array.fromHex calls that function from then on.",
    encoded: 0,
    expression: 'String(Uint8Array.fromHex("6869"))',
    attempts: [["stored", 'Uint8Array.fromHex = input => "the replacement got " + input;']],
  },
  {
    name: "redefined-from-base64.js",
    firstLine: "A program that defines Uint8Array.fromBase64 anew calls what it defined.",
    encoded: 0,
    expression: 'String(Uint8Array.fromBase64("aGk="))',
    attempts: [["defined", 'Object.defineProperty(Uint8Array, "fromBase64", { value: input => "the replacement got " + input });']],
  },
  {
    name: "replaced-from-base64-hidden-name.js",
    firstLine: "A program that stores into Uint8Array under a name that the build cannot read calls what it stored.",
    encoded: 0,
    expression: '[String(Uint8Array.fromBase64("aGk=")), String(Uint8Array.fromHex("6869"))].join(" | ")',
    setup: "const name = JSON.parse('\"fromBase64\"');",
    attempts: [["stored", 'Uint8Array[name] = input => "the replacement got " + input;']],
  },
  {
    name: "deleted-from-hex.js",
    firstLine: "After a program deletes Uint8Array.fromHex, the call throws.",
    encoded: 0,
    expression: '(() => { try { return String(Uint8Array.fromHex("6869")); } catch (error) { return "the call throws " + error.name; } })()',
    attempts: [["deleted", "delete Uint8Array.fromHex;"]],
  },
  {
    name: "method-added-to-prototype.js",
    firstLine: "A method added to Buffer.prototype or Uint8Array.prototype is visible on bytes made from a literal.",
    encoded: 2,
    expression: '[typeof Buffer.from("hi").added, typeof new TextEncoder().encode("hi").added, typeof Uint8Array.fromHex("6869").added].join(" ")',
    attempts: [
      ["on Buffer.prototype", "Buffer.prototype.added = function () {};"],
      ["on Uint8Array.prototype", "Uint8Array.prototype.added = function () {};"],
    ],
  },
  {
    name: "locked-buffer-from.js",
    firstLine: "A compiled executable keeps Buffer.from: a store, a definition and a deletion throw, and the call gives the bytes.",
    encoded: 1,
    expression: 'String(Buffer.from("literal", "latin1"))',
    attempts: [
      ["stored", 'Buffer.from = (input, encoding) => "the replacement got " + input + " " + encoding;'],
      ["defined", 'Object.defineProperty(Buffer, "from", { value: input => "the replacement got " + input });'],
      ["deleted", "delete Buffer.from;"],
    ],
    locked: { buildPrints: [`3 x ${lockedStore}`], output: ["before | literal", "stored throws TypeError", "then | literal", "defined throws TypeError", "then | literal", "deleted throws TypeError", "then | literal"] },
  },
  {
    name: "locked-buffer-from-hidden-name.js",
    firstLine: "A compiled executable keeps Buffer.from against a store under a name that the build cannot read.",
    encoded: 1,
    expression: 'String(Buffer.from("literal", "latin1"))',
    setup: "const name = JSON.parse('\"from\"');",
    attempts: [["stored", 'Buffer[name] = (input, encoding) => "the replacement got " + input + " " + encoding;']],
    locked: { buildPrints: [`1 x ${storeUnderHiddenName}`], output: ["before | literal", "stored throws TypeError", "then | literal"] },
  },
  {
    name: "replaced-from-hex-hidden-object.js",
    firstLine: "A program that stores into Uint8Array.fromHex through an object that the build cannot read calls what it stored.",
    encoded: 1,
    expression: 'String(Uint8Array.fromHex("6869"))',
    attempts: [["stored", "globalThis[JSON.parse('\"Uint8Array\"')].fromHex = input => \"the replacement got \" + input;"]],
  },
  {
    name: "replaced-from-base64-hidden-object.js",
    firstLine: "A program that defines Uint8Array.fromBase64 anew through an object that the build cannot read calls what it defined.",
    encoded: 1,
    expression: 'String(Uint8Array.fromBase64("aGk="))',
    attempts: [["defined", "Object.defineProperty(globalThis[JSON.parse('\"Uint8Array\"')], \"fromBase64\", { value: input => \"the replacement got \" + input });"]],
  },
  {
    name: "locked-buffer-from-hidden-object.js",
    firstLine: "A compiled executable keeps Buffer.from against a store through an object that the build cannot read.",
    encoded: 1,
    expression: 'String(Buffer.from("literal", "latin1"))',
    attempts: [["stored", "globalThis[JSON.parse('\"Buffer\"')].from = input => \"the replacement got \" + input;"]],
    locked: { buildPrints: [], output: ["before | literal", "stored throws TypeError", "then | literal"] },
  },
  {
    name: "locked-from-hex-in-eval.js",
    firstLine: "A compiled executable keeps Uint8Array.fromHex against a store made by code that is evaluated at run time.",
    encoded: 2,
    expression: 'String(Uint8Array.fromHex("6869"))',
    attempts: [["stored", "(0, eval)('Uint8Array.fromHex = input => \"the replacement got \" + input');"]],
    locked: { buildPrints: [], output: ["before | 104,105", "stored throws TypeError", "then | 104,105"] },
  },
  {
    name: "locked-typed-array-of.js",
    firstLine: "A compiled executable keeps %TypedArray%.of, which every typed array constructor inherits.",
    encoded: 0,
    expression: "String(Uint8Array.of(1, 2))",
    attempts: [["stored", 'Object.getPrototypeOf(Uint8Array).of = (...numbers) => "the replacement got " + numbers;']],
    locked: { buildPrints: [], output: ["before | 1,2", "stored throws TypeError", "then | 1,2"] },
  },
  {
    name: "locked-own-of-property.js",
    firstLine: "A compiled executable refuses an own property named of on Uint8Array, because it would hide the inherited one.",
    encoded: 0,
    expression: "String(Uint8Array.of(1, 2))",
    attempts: [["stored", 'Uint8Array.of = (...numbers) => "the own property got " + numbers;']],
    locked: { buildPrints: [`1 x ${lockedStore}`], output: ["before | 1,2", "stored throws TypeError", "then | 1,2"] },
  },
  {
    name: "locked-array-iterator.js",
    firstLine: "new Uint8Array([..]) and Uint8Array.from([..]) go through the array's iterator, which a compiled executable keeps.",
    encoded: 0,
    expression: '[String(new Uint8Array([1, 2, 3])), Buffer.from([1, 2, 3]).toString("hex"), String(Uint8Array.from([1, 2, 3])), String(Uint8Array.of(1, 2, 3))].join(" | ")',
    attempts: [["stored", "Array.prototype[Symbol.iterator] = function* () { yield 9; yield 8; };"]],
    locked: { buildPrints: [`1 x ${lockedStore}`], output: ["before | 1,2,3 | 010203 | 1,2,3 | 1,2,3", "stored throws TypeError", "then | 1,2,3 | 010203 | 1,2,3 | 1,2,3"] },
  },
];

function replacementProgram({ firstLine, encoded, expression, setup, attempts, locked }: Replacement): string {
  const lines = [`// ${firstLine}`, statistic(encoded), ...(locked?.buildPrints ?? []).map(line => `// Build prints: ${line}`)];
  if (setup) lines.push(setup);
  lines.push("function make() {", `  return ${expression};`, "}", 'console.log("before |", make());');
  for (const [label, statement] of attempts)
    lines.push("try {", `  ${statement}`, `  console.log(${JSON.stringify(label)});`, "} catch (error) {", `  console.log(${JSON.stringify(label + " throws")}, error.name);`, "}", 'console.log("then |", make());');
  if (locked) lines.push("/* Output:", ...locked.output, "*/");
  return lines.join("\n") + "\n";
}

const otherCallees: Record<string, string> = {
  "shadowed-by-local.ts": withStatistic(
    1,
    `// A local binding named Buffer, TextEncoder or Uint8Array is called in place of the global.
function withLocalBuffer() {
  const Buffer = { from: (input: string, encoding?: string) => "a local Buffer got " + input + " " + encoding };
  return Buffer.from("literal", "hex");
}
function withParameter(Buffer: { from(input: string): string }) {
  return Buffer.from("literal");
}
function withLocalClass() {
  class TextEncoder {
    encode(input: string) {
      return "a local TextEncoder got " + input;
    }
  }
  return new TextEncoder().encode("literal");
}
function withLocalTypedArray() {
  const Uint8Array = { fromBase64: (input: string) => "a local Uint8Array got " + input, fromHex: (input: string) => "hex " + input, of: (...numbers: number[]) => numbers.length };
  return [Uint8Array.fromBase64("aGk="), Uint8Array.fromHex("6869"), Uint8Array.of(1, 2, 3)].join(" | ");
}
console.log(withLocalBuffer());
console.log(withParameter({ from: input => "a parameter got " + input }));
console.log(withLocalClass());
console.log(withLocalTypedArray());
console.log(Buffer.from("the global still works", "latin1").toString("hex"));
export {};
`,
  ),
  "shadowed-by-module-binding.ts": withStatistic(
    1,
    `// A binding of the module named Buffer is called in place of the global, in every function of the module.
const Buffer = {
  from(input: string, encoding?: string) {
    return "the module's Buffer got " + input + " " + encoding;
  },
};
class TextEncoder {
  encode(input: string) {
    return "the module's TextEncoder got " + input;
  }
}
function inFunction() {
  return [Buffer.from("literal"), Buffer.from("6869", "hex"), new TextEncoder().encode("literal")].join(" | ");
}
console.log(Buffer.from("at top level"));
console.log(inFunction());
console.log(globalThis.Buffer.from("6869", "hex").toString());
export {};
`,
  ),
  ...Object.fromEntries(replacements.map(replacement => [replacement.name, replacementProgram(replacement)])),
  "subclasses.js": withStatistic(
    0,
    `// A class that extends Buffer, Uint8Array or TextEncoder gives what plain Bun gives for the inherited functions.
function kindOf(value) {
  const prototype = Object.getPrototypeOf(value);
  return [value.constructor.name, prototype === Buffer.prototype, prototype === Uint8Array.prototype, Buffer.isBuffer(value), String(value)].join(" ");
}
function attempt(label, make) {
  try {
    console.log(label, "|", kindOf(make()));
  } catch (error) {
    console.log(label, "| throws", error.name, "|", error.code, "|", error.message);
  }
}
class OwnBuffer extends Buffer {}
class OwnBytes extends Uint8Array {}
class OwnEncoder extends TextEncoder {}
class LoudEncoder extends TextEncoder {
  encode(input) {
    return super.encode(input + "!");
  }
}
class OwnFrom extends Buffer {
  static from(input) {
    return "the subclass's from got " + input;
  }
}
attempt("OwnBuffer.from", () => OwnBuffer.from("literal"));
attempt("OwnBuffer.from with an encoding", () => OwnBuffer.from("6869", "hex"));
attempt("OwnBuffer.from numbers", () => OwnBuffer.from([1, 2, 3]));
attempt("OwnFrom.from", () => OwnFrom.from("literal"));
attempt("OwnBytes.fromBase64", () => OwnBytes.fromBase64("aGk="));
attempt("OwnBytes.fromHex", () => OwnBytes.fromHex("6869"));
attempt("OwnBytes.of", () => OwnBytes.of(1, 2, 3));
attempt("OwnBytes.from", () => OwnBytes.from([1, 2, 3]));
attempt("new OwnBytes", () => new OwnBytes([1, 2, 3]));
attempt("OwnEncoder", () => new OwnEncoder().encode("literal"));
attempt("LoudEncoder", () => new LoudEncoder().encode("literal"));
`,
  ),
  "other-receivers.js": withStatistic(
    5,
    `// Buffer.from, TextEncoder.prototype.encode and the static functions of Uint8Array are called with other receivers.
function kindOf(value) {
  if (typeof value !== "object" || value === null) return typeof value + " " + String(value);
  const prototype = Object.getPrototypeOf(value);
  return [value.constructor.name, prototype === Buffer.prototype, prototype === Uint8Array.prototype, Buffer.isBuffer(value), String(value)].join(" ");
}
function attempt(label, make) {
  try {
    console.log(label, "|", kindOf(make()));
  } catch (error) {
    console.log(label, "| throws", error.name, "|", error.code, "|", error.message);
  }
}
class Other {
  constructor(...given) {
    this.given = given.length;
  }
}
attempt("Buffer.from.call(undefined)", () => Buffer.from.call(undefined, "literal"));
attempt("Buffer.from.call(null)", () => Buffer.from.call(null, "6869", "hex"));
attempt("Buffer.from.call(Other)", () => Buffer.from.call(Other, "literal"));
attempt("Buffer.from.call(Uint8Array)", () => Buffer.from.call(Uint8Array, "literal"));
attempt("Buffer.from.apply", () => Buffer.from.apply(Buffer, ["6869", "hex"]));
attempt("Reflect.apply of Buffer.from", () => Reflect.apply(Buffer.from, undefined, ["literal"]));
attempt("Buffer.from.bind", () => Buffer.from.bind(null, "6869")("hex"));
attempt("new Buffer.from", () => new Buffer.from("literal"));
attempt("new Buffer.from with an encoding", () => new Buffer.from("6869", "hex"));
attempt("Reflect.construct of Buffer.from", () => Reflect.construct(Buffer.from, ["literal"], Other));
attempt("an optional call", () => Buffer.from?.("literal"));
attempt("an optional member", () => Buffer?.from("literal"));
attempt("a comma before the call", () => (0, Buffer.from)("literal"));
attempt("a comma before the literal", () => Buffer.from((0, "after the comma")));
attempt("a computed name", () => Buffer["from"]("literal"));
attempt("Buffer called", () => Buffer("literal"));
attempt("new Buffer", () => new Buffer("6869", "hex"));
attempt("encode.call({})", () => TextEncoder.prototype.encode.call({}, "literal"));
attempt("encode.call(undefined)", () => TextEncoder.prototype.encode.call(undefined, "literal"));
attempt("encode.call(prototype)", () => TextEncoder.prototype.encode.call(TextEncoder.prototype, "literal"));
attempt("encode.call(a decoder)", () => TextEncoder.prototype.encode.call(new TextDecoder(), "literal"));
attempt("encode.call(an encoder)", () => TextEncoder.prototype.encode.call(new TextEncoder(), "literal"));
attempt("encode, detached", () => (0, new TextEncoder().encode)("literal"));
attempt("new encode", () => new (new TextEncoder().encode)("literal"));
attempt("TextEncoder called without new", () => TextEncoder().encode("literal"));
attempt("fromBase64.call(undefined)", () => Uint8Array.fromBase64.call(undefined, "aGk="));
attempt("fromBase64.call(Other)", () => Uint8Array.fromBase64.call(Other, "aGk="));
attempt("fromBase64.call(Buffer)", () => Uint8Array.fromBase64.call(Buffer, "aGk="));
attempt("Buffer.fromBase64", () => Buffer.fromBase64("aGk="));
attempt("Buffer.fromHex", () => Buffer.fromHex("6869"));
attempt("Int8Array.fromHex", () => Int8Array.fromHex("6869"));
attempt("fromHex.call(Other)", () => Uint8Array.fromHex.call(Other, "6869"));
attempt("new fromHex", () => new Uint8Array.fromHex("6869"));
attempt("of.call(Other)", () => Uint8Array.of.call(Other, 1, 2, 3));
attempt("of.call(Buffer)", () => Uint8Array.of.call(Buffer, 1, 2, 3));
attempt("of.call(undefined)", () => Uint8Array.of.call(undefined, 1, 2, 3));
attempt("of.call(Uint16Array)", () => Uint8Array.of.call(Uint16Array, 1, 2, 300));
attempt("Uint8Array called without new", () => Uint8Array([1, 2, 3]));
attempt("Reflect.construct of Uint8Array", () => Reflect.construct(Uint8Array, [[1, 2, 3]], Buffer));
attempt("Reflect.construct with another new.target", () => Reflect.construct(Uint8Array, [[1, 2, 3]], Other));
`,
  ),
  "pool-size.js": withStatistic(
    4,
    `// Buffer.poolSize can be read and written. Its value does not change the offset or the buffer of bytes made from a literal.
function where(bytes) {
  return [bytes.byteOffset, bytes.buffer.byteLength, bytes.length].join(" ");
}
function make() {
  return [where(Buffer.from("a")), where(Buffer.from("hello, world")), where(Buffer.from("6869", "hex")), where(Buffer.from([1, 2, 3])), where(Buffer.from("aGk=", "base64"))].join(" | ");
}
console.log(Buffer.poolSize, "|", make());
Buffer.poolSize = 0;
console.log(Buffer.poolSize, "|", make());
Buffer.poolSize = 1 << 20;
console.log(Buffer.poolSize, "|", make());
`,
  ),
};

/** The whole table. `bun test/aot/generate.ts byte-literals <where>` writes it. */
export const files = (): Record<string, string> => ({
  "buffer-from-every-encoding.ts": bufferFromEveryEncoding(false),
  "encoding-name-spellings.js": encodingNameSpellings(false),
  "hex-strings.ts": hexStringProgram(false),
  "base64-strings.ts": base64StringProgram(false),
  "from-base64-options.js": fromBase64Options(),
  "text-encoder-strings.ts": textEncoderStrings(false),
  "text-encoder-non-strings.js": textEncoderNonStrings(),
  "long-literals.ts": longLiterals([333, 499, 500, 501, 750, 999, 1000, 1001, 1334, 2000, 70000]),
  "constant-numbers.js": constantNumbers(false),
  "indirect-constants.ts": withStatistic(33, indirectConstants),
  ...otherCallees,
});

/** The subset stored under parallel/byte-literals, which every test run builds. */
export const storedFiles = (): Record<string, string> => ({
  "buffer-from-every-encoding.ts": bufferFromEveryEncoding(true),
  "encoding-name-spellings.js": encodingNameSpellings(true),
  "hex-strings.ts": hexStringProgram(true),
  "base64-strings.ts": base64StringProgram(true),
  "text-encoder-strings.ts": textEncoderStrings(true),
  "long-literals.ts": longLiterals([1000, 1001]),
  "constant-numbers.js": constantNumbers(true),
  "indirect-constants.ts": withStatistic(33, indirectConstants),
  ...otherCallees,
});

export const programs = () => programsOf(files());

if (import.meta.main) {
  const where = process.argv[2];
  if (where === undefined) throw new Error("bun test/aot/generate/byte-literals.ts <where>");
  mkdirSync(where, { recursive: true });
  for (const [name, source] of Object.entries(storedFiles())) writeFileSync(join(where, name), source);
}
