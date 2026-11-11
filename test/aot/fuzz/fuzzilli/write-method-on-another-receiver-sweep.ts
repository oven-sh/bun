// A method of a built-in class is called on a receiver that is not of that class: the method, times the receiver, times the road by which it is called, times what is done with what comes back, times where the call stands. Each program holds one of each and
// is built alone.
//
//   bun write-method-on-another-receiver-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<method>--<receiver>--<road>--<use>--<where>.cjs
//   bun write-method-on-another-receiver-sweep.ts count
//   bun write-method-on-another-receiver-sweep.ts named <pattern> <folder> [most]
//
// Some methods take any receiver and make a text or a list-like of it, some throw a TypeError. An iterator that is shown is stepped twice.
import { mkdirSync, writeFileSync } from "fs";

// The method, its arguments, and a receiver of its own kind.
const methods: [string, string, string, string][] = [
  ["the-iterator-of-a-text", "String.prototype[Symbol.iterator]", "", '"121"'],
  ["at-of-a-text", "String.prototype.at", "0", '"121"'],
  ["char-at", "String.prototype.charAt", "0", '"121"'],
  ["char-code-at", "String.prototype.charCodeAt", "0", '"121"'],
  ["code-point-at", "String.prototype.codePointAt", "0", '"121"'],
  ["index-of-of-a-text", "String.prototype.indexOf", '"1"', '"121"'],
  ["includes-of-a-text", "String.prototype.includes", '"1"', '"121"'],
  ["slice-of-a-text", "String.prototype.slice", "0, 2", '"121"'],
  ["substring", "String.prototype.substring", "0, 2", '"121"'],
  ["to-upper-case", "String.prototype.toUpperCase", "", '"121"'],
  ["trim", "String.prototype.trim", "", '"121"'],
  ["pad-start", "String.prototype.padStart", '4, "-"', '"121"'],
  ["repeat", "String.prototype.repeat", "2", '"121"'],
  ["split", "String.prototype.split", '""', '"121"'],
  ["concat-of-a-text", "String.prototype.concat", '"x"', '"121"'],
  ["starts-with", "String.prototype.startsWith", '"1"', '"121"'],
  ["value-of-of-a-text", "String.prototype.valueOf", "", '"121"'],
  ["the-iterator-of-a-list", "Array.prototype[Symbol.iterator]", "", "[1, 2, 1]"],
  ["keys-of-a-list", "Array.prototype.keys", "", "[1, 2, 1]"],
  ["entries-of-a-list", "Array.prototype.entries", "", "[1, 2, 1]"],
  ["push", "Array.prototype.push", "7", "[1, 2, 1]"],
  ["pop", "Array.prototype.pop", "", "[1, 2, 1]"],
  ["index-of-of-a-list", "Array.prototype.indexOf", "1", "[1, 2, 1]"],
  ["includes-of-a-list", "Array.prototype.includes", "1", "[1, 2, 1]"],
  ["join", "Array.prototype.join", '"+"', "[1, 2, 1]"],
  ["slice-of-a-list", "Array.prototype.slice", "0, 2", "[1, 2, 1]"],
  ["map-of-a-list", "Array.prototype.map", "one => one", "[1, 2, 1]"],
  ["for-each", "Array.prototype.forEach", "one => one", "[1, 2, 1]"],
  ["at-of-a-list", "Array.prototype.at", "0", "[1, 2, 1]"],
  ["fill-of-a-list", "Array.prototype.fill", "3", "[1, 2, 1]"],
  ["reverse", "Array.prototype.reverse", "", "[1, 2, 1]"],
  ["get-of-a-map", "Map.prototype.get", "1", "new Map([[1, 2]])"],
  ["set-of-a-map", "Map.prototype.set", "1, 2", "new Map([[1, 2]])"],
  ["has-of-a-map", "Map.prototype.has", "1", "new Map([[1, 2]])"],
  ["the-iterator-of-a-map", "Map.prototype[Symbol.iterator]", "", "new Map([[1, 2]])"],
  ["has-of-a-set", "Set.prototype.has", "1", "new Set([1])"],
  ["add", "Set.prototype.add", "1", "new Set([1])"],
  ["values-of-a-set", "Set.prototype.values", "", "new Set([1])"],
  ["to-fixed", "Number.prototype.toFixed", "1", "5"],
  ["to-string-of-a-number", "Number.prototype.toString", "", "5"],
  ["value-of-of-a-number", "Number.prototype.valueOf", "", "5"],
  ["at-of-a-typed-list", "Uint8Array.prototype.at", "0", "Uint8Array.of(1, 2, 1)"],
  ["the-iterator-of-a-typed-list", "Uint8Array.prototype[Symbol.iterator]", "", "Uint8Array.of(1, 2, 1)"],
  ["fill-of-a-typed-list", "Uint8Array.prototype.fill", "3", "Uint8Array.of(1, 2, 1)"],
  ["has-own-property", "Object.prototype.hasOwnProperty", '"length"', "{ length: 1 }"],
  ["to-string-of-an-object", "Object.prototype.toString", "", "{ length: 1 }"],
  ["test", "RegExp.prototype.test", '"1"', "/1/"],
  ["get-time", "Date.prototype.getTime", "", "new Date(0)"],
  ["to-string-of-a-big-integer", "BigInt.prototype.toString", "", "5n"],
  ["to-string-of-a-symbol", "Symbol.prototype.toString", "", 'Symbol("mark")'],
];

const receivers: [string, string][] = [
  ["a-text", '"121"'],
  ["an-empty-text", '""'],
  ["a-text-made-at-run-time", "String(121)"],
  ["a-whole-number", "5"],
  ["a-fraction", "1.5"],
  ["not-a-number", "NaN"],
  ["a-big-integer", "5n"],
  ["true", "true"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["a-list", "[1, 2, 1]"],
  ["an-empty-list", "[]"],
  ["a-record-with-a-length", '{ length: 2, 0: 1, 1: "1" }'],
  ["a-map", "new Map([[1, 2]])"],
  ["a-set", "new Set([1])"],
  ["a-typed-list", "Uint8Array.of(1, 2, 1)"],
  ["a-function", "function named(one) {}"],
  ["a-symbol", 'Symbol("mark")'],
  ["a-boxed-text", 'new String("121")'],
  ["a-date", "new Date(0)"],
];

// What stands in front, and the call. BEHIND is the arguments with a comma in front of them where there are any.
const roads: [string, string, string][] = [
  ["call", "", "METHOD.call(RECEIVERBEHIND)"],
  ["apply", "", "METHOD.apply(RECEIVER, [ARGUMENTS])"],
  ["reflect-apply", "", "Reflect.apply(METHOD, RECEIVER, [ARGUMENTS])"],
  ["bound", "", "METHOD.bind(RECEIVER)(ARGUMENTS)"],
  ["call-bound-over-it", "const uncurried = Function.prototype.call.bind(METHOD);", "uncurried(RECEIVERBEHIND)"],
  ["held-in-a-constant", "const method = METHOD;", "method.call(RECEIVERBEHIND)"],
];

// What is done with what comes back. CALL is the call.
const uses: [string, string][] = [
  ["shown", "show(CALL)"],
  ["stepped-on-the-spot", "show(CALL.next().value)"],
  ["spread", "show([...CALL])"],
  ["its-length", "show(CALL.length)"],
  ["joined-to-a-text", 'show("" + CALL)'],
  ["times-one", "show(CALL * 1)"],
];

const wheres = ["at-the-top", "in-a-function-that-a-loop-calls", "in-a-loop", "behind-a-receiver-of-its-own-kind"];

const all = methods.length * receivers.length * roads.length * uses.length * wheres.length;

const shows = `function show(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return typeof value + " " + String(value);
  if (typeof value.next === "function") return "steps " + JSON.stringify([value.next(), value.next()]);
  if (Array.isArray(value)) return "list " + JSON.stringify(value);
  if (value instanceof Map || value instanceof Set) return Object.prototype.toString.call(value) + " " + value.size;
  return Object.prototype.toString.call(value) + " " + JSON.stringify(value);
}`;

const joined = (...parts: string[]) => parts.filter(Boolean).join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [receiver, made] = pick(receivers);
  const [method, read, handed, own] = pick(methods);
  const [road, inFront, calls] = pick(roads);
  const [use, used] = pick(uses);
  const where = pick(wheres);
  const laid = (text: string, on: string) =>
    text
      .replaceAll("METHOD", () => read)
      .replaceAll("RECEIVERBEHIND", () => on + (handed ? ", " + handed : ""))
      .replaceAll("RECEIVER", () => on)
      .replaceAll("ARGUMENTS", () => handed);
  const wrapped = (value: string) => (/^[{f]/.test(value) ? `(${value})` : value);
  const does = (on: string) => used.replace("CALL", () => laid(calls, on));
  const caught = (by: string, stores: string) => joined(`${by}try {`, `${by}  ${stores}`, `${by}} catch (error) {`, `${by}  said = error.constructor.name;`, `${by}}`); // prettier-ignore
  const says = 'console.log("SAID " + said);';
  const body =
    where === "at-the-top"
      ? joined("let said;", caught("", `said = ${does(wrapped(made))};`), says)
      : where === "in-a-loop"
        ? joined(
            "function work(receiver) {",
            '  let last = "";',
            `  for (let turn = 0; turn < 3; turn++) last = ${does("receiver")};`,
            "  return last;",
            "}",
            "let said;",
            caught("", `said = work(${made});`),
            says,
          )
        : where === "in-a-function-that-a-loop-calls"
          ? joined(
              "function work(receiver) {",
              `  return ${does("receiver")};`,
              "}",
              "let said;",
              "for (let turn = 0; turn < 3; turn++) {",
              caught("  ", `said = work(${made});`),
              "}",
              says,
            )
          : joined(
              "function work(receiver) {",
              `  return ${does("receiver")};`,
              "}",
              `for (const receiver of [${own}, ${made}, ${own}]) {`,
              "  let said;",
              caught("  ", "said = work(receiver);"),
              "  " + says,
              "}",
            );
  return {
    name: `${method}--${receiver}--${road}--${use}--${where}.cjs`,
    text: joined(shows, laid(inFront, ""), body) + "\n",
  };
}

const pad = (at: number) => String(at).padStart(6, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
