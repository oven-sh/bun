// One call over several receivers: three kinds of receivers that meet at it, times how the call is written, times what stands around it. What fails is told by its name.
//
//   bun write-call-target-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<call>--<around>--<receivers>.mjs or .ts
//   bun write-call-target-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const receivers: [name: string, made: string][] = [
  ["literal", "{ m(a) { return a + 1; }, x: 1 }"],
  ["other-literal", "{ x: 2, y: 3, m: a => a * 2 }"],
  ["instance", "new Item(1)"],
  ["heir", "new Heir(2)"],
  ["field", "new Holder(3)"],
  ["number", "{ m: 5, x: 1 }"],
  ["double", "{ m: 2.5, x: 1 }"],
  ["nothing", "{ x: 1 }"],
  ["undefined", "{ m: undefined, x: 1 }"],
  ["null", "{ m: null }"],
  ["text", '{ m: "text", x: 1 }'],
  ["object", "{ m: { x: 1 }, x: 1 }"],
  ["class", "{ m: Item, x: 1 }"],
  ["accessor", "{ get m() { return a => a + 10; }, x: 1 }"],
  ["throwing-accessor", '{ get m() { throw new Error("asked"); } }'],
  ["bound", "{ m: ((a, b) => [a, b].join()).bind(null, 7) }"],
  ["without-prototype", "Object.assign(Object.create(null), { m: a => a + 3 })"],
  ["above", "Object.create({ m(a) { return a + this.x; }, x: 4 })"],
  ["list", "Object.assign([1, 2], { m: a => a })"],
  ["function", "Object.assign(() => 1, { m: a => a + 5 })"],
  ["map", "new Map([[1, 2]])"],
  ["built-in", "{ m: Math.max, x: 1 }"],
  ["built-in-method", "{ m: Array.prototype.push, length: 0 }"],
  ["generator", "{ *m(a) { yield a; } }"],
  ["async", "{ async m(a) { return a; } }"],
  ["proxy", "new Proxy({}, { get: (_, key) => (key === \"m\" ? a => a + 6 : undefined) })"],
  ["of-nothing", "undefined"],
  ["of-null", "null"],
  ["of-a-number", "7"],
  ["of-a-text", '"text"'],
  ["frozen", "Object.freeze({ m: a => a + 8 })"],
]; // prettier-ignore
const calls: [name: string, text: string][] = [
  ["method", "o.m(a)"],
  ["by-text", 'o["m"](a)'],
  ["by-name", "o[key](a)"],
  ["if-there", "o.m?.(a)"],
  ["if-anything", "o?.m(a)"],
  ["taken-out", "taken(o)(a)"],
  ["loose", "(0, o.m)(a)"],
  ["call", "o.m.call(o, a)"],
  ["apply", "o.m.apply(o, [a])"],
  ["new", "new o.m(a)"],
  ["spread", "o.m(...[a, 2])"],
  ["none", "o.m()"],
  ["three", "o.m(a, 2, 3)"],
  ["template", "o.m`x${a}`"],
  ["twice", "o.m(o.x)"],
  ["length", "o.m.length"],
  ["typeof", "typeof o.m"],
  ["of-the-result", "o.m(a).toFixed(1)"],
  ["reflect", "Reflect.apply(o.m, o, [a])"],
];
const around: [name: string, text: string][] = [
  ["loop", "for (const o of given) tell(() => CALL);"],
  ["function", "function ask(o, a) {\n  return CALL;\n}\nfor (const o of given) tell(() => ask(o, a));"],
  ["loop-in-a-function", "function ask(o, a) {\n  let last;\n  for (let i = 0; i < 3; i++) last = CALL;\n  return last;\n}\nfor (const o of given) tell(() => ask(o, a));"],
  ["list-in-a-function", "function ask(list, a) {\n  const out = [];\n  for (const o of list)\n    try {\n      out.push(show(CALL));\n    } catch (error) {\n      out.push(error.name);\n    }\n  return out.join();\n}\ntell(() => ask(given, a));"],
  ["chosen", "function ask(i, a) {\n  const o = i === 0 ? given[0] : i === 1 ? given[1] : given[2];\n  return CALL;\n}\nfor (let i = 0; i < 3; i++) tell(() => ask(i, a));"],
  ["held", "class Keeper {\n  constructor(o) {\n    this.o = o;\n  }\n  ask(a) {\n    const { o } = this;\n    return CALL;\n  }\n}\nfor (const o of given) tell(() => new Keeper(o).ask(a));"],
]; // prettier-ignore
const total = calls.length * around.length * receivers.length * receivers.length * 7;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const call = pick(calls);
  const place = pick(around);
  const first = pick(receivers);
  const second = pick(receivers);
  const third = receivers[(cell * 13 + rest * 5) % receivers.length];
  const isTyped = cell % 5 === 1;
  const typed = (text: string) =>
    isTyped
      ? text
          .replaceAll(/\b(m|function ask|ask)\(a\)( =>)? \{/g, "$1(a: any)$2: any {")
          .replaceAll("m(a) {", "m(a: any): any {")
          .replaceAll("*m(a: any): any {", "*m(a: any) {")
          .replaceAll("async m(a: any): any {", "async m(a: any) {")
          .replaceAll(/(?<![\w.(])a =>/g, "(a: any) =>")
          .replaceAll("((a, b) =>", "((a: any, b: any) =>")
          .replaceAll("ask(o, a) {", "ask(o: any, a: any): any {")
          .replaceAll("ask(list, a) {", "ask(list: any[], a: any): any {")
          .replaceAll("ask(i, a) {", "ask(i: number, a: any): any {")
          .replaceAll("constructor(o) {", "o: any;\n  constructor(o: any) {")
          .replaceAll("let last;", "let last: any;")
          .replaceAll("const out = []", "const out: string[] = []")
          .replaceAll("catch (error)", "catch (error: any)")
          .replaceAll("a + this.x; }, x: 4", "a + (this as any).x; }, x: 4")
          .replaceAll("get: (_, key)", "get: (_: any, key: any)")
      : text; // prettier-ignore
  const any = isTyped ? ": any" : "";
  const lines = [
    "class Item {",
    ...(isTyped ? ["  x: any;"] : []),
    `  constructor(x${any}) {`,
    "    this.x = x;",
    "  }",
    `  m(a${any})${any} {`,
    "    return this?.x + a;",
    "  }",
    "}",
    "class Heir extends Item {",
    `  m(a${any})${any} {`,
    "    return super.m(a) + 1;",
    "  }",
    "}",
    "class Holder {",
    ...(isTyped ? ["  x: any;"] : []),
    `  m = (a${any}) => a - this.x;`,
    `  constructor(x${any}) {`,
    "    this.x = x;",
    "  }",
    "}",
    `const show = (value${any}) => (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "-0" : String(value));`,
    "const told = [];".replace("told =", isTyped ? "told: string[] =" : "told ="),
    `function tell(asked${isTyped ? ": () => any" : ""}) {`,
    "  try {",
    "    told.push(show(asked()));",
    "  } catch (error) {",
    isTyped ? "    told.push((error as any).name);" : "    told.push(error.name);",
    "  }",
    "}",
    `const taken = (o${any}) => o.m;`,
    `const key${any} = ["m"][process.argv.length > 9 ? 1 : 0];`,
    `const a${any} = ${cell % 2 ? "JSON.parse(\"4\")" : "4"};`,
    `const given${isTyped ? ": any[]" : ""} = [${[first, second, third].map(one => typed(one[1])).join(", ")}];`,
    ...typed(place[1].replaceAll("CALL", () => call[1])).split("\n"),
    ...typed(place[1].replaceAll("CALL", () => call[1])).split("\n").filter(line => line.startsWith("for") || line.startsWith("tell")),
    'console.log(told.join("\\n"));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${call[0]}--${place[0]}--${first[0]}--${second[0]}--${third[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
