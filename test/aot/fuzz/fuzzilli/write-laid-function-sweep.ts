// A function is laid where the language or the library will call it: where it is laid, times how the function is given, times where the deed that calls it stands, times the kind of file. Each program holds
// one of each and is built alone.
//
//   bun write-laid-function-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<place>--<given>--<stands>.mjs or .ts
//   bun write-laid-function-sweep.ts count
//   bun write-laid-function-sweep.ts named <pattern> <folder> [most]
//
// A function that is written where it is laid can be seen there. One that comes out of a list, a map or a call, off an instance or out of the library, is a value like any other.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

// The parameters and what the function hands back, what lays it, and the deed that has it called. GIVEN is the expression that gives the function. ANY is `: any` in TypeScript and nothing elsewhere.
const places: [string, string, string, string, string][] = [
  ["a-getter", "", "7", 'const holderANY = {};\nObject.defineProperty(holder, "part", { get: GIVEN });', "holder.part"],
  [
    "a-setter",
    "valueANY",
    "void (seen += value)",
    'const holderANY = {};\nObject.defineProperty(holder, "part", { set: GIVEN });',
    "((holder.part = 2), seen)",
  ],
  [
    "a-value-of-a-descriptor",
    "",
    "7",
    'const holderANY = {};\nObject.defineProperty(holder, "part", { value: GIVEN });',
    "holder.part()",
  ],
  ["a-method-that-is-stored", "", "7", "const holderANY = {};\nholder.part = GIVEN;", "holder.part()"],
  ["a-method-in-a-literal", "", "7", "const holderANY = { part: GIVEN };", "holder.part()"],
  [
    "a-field-of-a-class",
    "",
    "7",
    "class Held {\n  partANY = GIVEN;\n}\nconst holderANY = new Held();",
    "holder.part()",
  ],
  ["to-string", "", '"seven"', "const holderANY = {};\nholder.toString = GIVEN;", "`${holder}`"],
  ["value-of", "", "7", "const holderANY = {};\nholder.valueOf = GIVEN;", "holder + 1"],
  ["to-primitive", "", "7", "const holderANY = {};\nholder[Symbol.toPrimitive] = GIVEN;", "holder + 1"],
  ["to-json", "", "7", "const holderANY = {};\nholder.toJSON = GIVEN;", "JSON.stringify(holder)"],
  [
    "has-instance",
    "",
    "true",
    "const holderANY = {};\nObject.defineProperty(holder, Symbol.hasInstance, { value: GIVEN });",
    "({}) instanceof holder",
  ],
  [
    "the-iterator",
    "",
    "[7, 8][Symbol.iterator]()",
    "const holderANY = {};\nholder[Symbol.iterator] = GIVEN;",
    "[...holder].join()",
  ],
  [
    "then",
    "doneANY",
    "done(7)",
    "const holderANY = {};\nholder.then = GIVEN;",
    '(await Promise.race([holder, new Promise(late => setTimeout(late, 20, "late"))]))',
  ],
  ["a-trap-for-reads", "", "7", "const holderANY = new Proxy({}, { get: GIVEN });", "holder.part"],
  ["a-trap-for-calls", "", "7", "const holderANY = new Proxy(function () {}, { apply: GIVEN });", "holder()"],
  ["handed-to-map", "", "7", "const handedANY = GIVEN;", "[1, 2].map(handed).join()"],
  ["handed-to-sort", "aANY, bANY", "a - b", "const handedANY = GIVEN;", "[3, 1, 2].sort(handed).join()"],
  ["handed-to-reduce", "sumANY, eachANY", "sum + each", "const handedANY = GIVEN;", "[1, 2, 3].reduce(handed, 0)"],
  ["handed-to-array-from", "", "7", "const handedANY = GIVEN;", "Array.from({ length: 2 }, handed).join()"],
  ["handed-to-replace", "", '"seven"', "const handedANY = GIVEN;", '"a-a".replace(/a/g, handed)'],
  [
    "handed-to-json-parse",
    "keyANY, valueANY",
    "value",
    "const handedANY = GIVEN;",
    'JSON.stringify(JSON.parse("[1,2]", handed))',
  ],
  [
    "handed-to-json-stringify",
    "keyANY, valueANY",
    "value",
    "const handedANY = GIVEN;",
    "JSON.stringify([1, 2], handed)",
  ],
  ["handed-to-then", "", "7", "const handedANY = GIVEN;", "(await Promise.resolve(1).then(handed))"],
  [
    "a-listener",
    "",
    "void (seen += 1)",
    'const targetANY = new EventTarget();\ntarget.addEventListener("told", GIVEN);',
    '(target.dispatchEvent(new Event("told")), seen)',
  ],
  ["the-tag-of-a-template", "", "7", "const handedANY = GIVEN;", "handed`a${1}b`"],
  ["called-by-call", "", "7", "const handedANY = GIVEN;", "handed.call(null)"],
  ["called-by-apply", "", "7", "const handedANY = GIVEN;", "handed.apply(null, [])"],
  ["called-by-reflection", "", "7", "const handedANY = GIVEN;", "Reflect.apply(handed, null, [])"],
  ["called-with-new", "", "{ made: 7 }", "const handedANY = GIVEN;", "JSON.stringify(new handed())"],
  [
    "the-parent-of-a-class",
    "",
    "{ made: 7 }",
    "const handedANY = GIVEN;\nclass Below extends handed {}",
    "JSON.stringify(new Below())",
  ],
];

// What stands in front, and the expression. PARAMS and BODY come from the place.
const givens: [string, string, string][] = [
  ["an-arrow", "", "(PARAMS) => BODY"],
  ["an-async-arrow", "", "async (PARAMS) => BODY"],
  ["a-function", "", "function (PARAMS) {\n  return BODY;\n}"],
  ["an-async-function", "", "async function (PARAMS) {\n  return BODY;\n}"],
  ["a-generator-function", "", "function* (PARAMS) {\n  yield BODY;\n}"],
  [
    "a-method-of-an-instance",
    "class Maker {\n  load(PARAMS)ANY {\n    return BODY;\n  }\n}\nconst maker = new Maker();",
    "maker.load",
  ],
  ["a-static-method", "class Maker {\n  static load(PARAMS)ANY {\n    return BODY;\n  }\n}", "Maker.load"],
  ["out-of-a-list", "const listANY = [(PARAMS) => BODY, () => 8];", "list[0]"],
  ["out-of-a-map", 'const tableANY = new Map([["k", (PARAMS) => BODY]]);', 'table.get("k")'],
  ["out-of-a-record", "const kitANY = { load: (PARAMS) => BODY };", "kit.load"],
  ["a-name-taken-out-of-a-record", "const { load }ANY = { load: (PARAMS) => BODY };", "load"],
  ["made-by-a-call", "const makeANY = () => (PARAMS) => BODY;", "make()"],
  ["a-bound-function", "function load(PARAMS)ANY {\n  return BODY;\n}", "load.bind(null)"],
  ["a-declared-function", "function load(PARAMS)ANY {\n  return BODY;\n}", "load"],
  ["a-constant", "const loadANY = (PARAMS) => BODY;", "load"],
  ["a-let-that-was-stored-twice", "let loadANY = () => 8;\nload = (PARAMS) => BODY;", "load"],
  [
    "a-choice-that-the-run-makes",
    "const firstANY = (PARAMS) => BODY;\nconst secondANY = () => 8;",
    '(JSON.parse("true") ? first : second)',
  ],
  ["a-function-of-the-library", "", "Object.prototype.toString"],
  ["a-class", "", "class {\n  made = 7;\n}"],
];

// DEED is the deed.
const stands: [string, string][] = [
  ["straight", "out += String(DEED);"],
  ["in-a-loop", 'for (let i = 0; i < 40; i++) out += String(DEED) + "|";'],
  [
    "in-a-function-called-from-a-loop",
    'FUNCTION deed()RETURNS {\n  return DEED;\n}\nfor (let i = 0; i < 40; i++) out += String(AWAIT deed()) + "|";',
  ],
];

const files = ["mjs", "ts"] as const;

const all = places.length * givens.length * stands.length * files.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [given, inFront, gives] = pick(givens);
  const [stand, shape] = pick(stands);
  const [place, params, body, lays, deed] = pick(places);
  const file = pick(files);
  const fitted = (text: string) => text.replaceAll("PARAMS", params).replaceAll("BODY", () => body);
  const waits = deed.includes("await ");
  const text = [
    "let seen = 0;",
    fitted(inFront),
    'let out = "";',
    "try {",
    [
      lays.replace("GIVEN", () => (file === "ts" ? `(${fitted(gives)}) as any` : fitted(gives))),
      shape
        .replaceAll("DEED", () => deed)
        .replace("FUNCTION", waits ? "async function" : "function")
        .replace("AWAIT ", waits ? "await " : "")
        .replace("RETURNS", file !== "ts" ? "" : waits ? ": Promise<any>" : ": any"),
    ]
      .join("\n")
      .replace(/^/gm, "  "),
    "} catch (error) {",
    `  out += "threw " + (error${file === "ts" ? " as Error" : ""}).name;`,
    "}",
    'console.log("SAID " + out);',
    file === "ts" && "export {};",
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("ANY", file === "ts" ? ": any" : "");
  return { name: `${place}--${given}--${stand}.${file}`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
  }
  console.log(Math.min(count, all));
}
