// The programs of nothing-throws-because-of-a-type that are not written by hand: `bun test/aot/generate.ts nothing-throws-because-of-a-type <where>` writes them.
// A type that is written in a program is a claim, not a check: a value that does not fit it gets where it is put, and the code behind it does what plain Bun does with that value.
// Each way to get a value of another kind into a field meets each kind of object that has typed fields, and the field is read right behind it by code that believes the type:
//   once          in the function that broke the type
//   in a loop     that has read the field a few hundred times before the type is broken
//   in a function with a typed parameter, which has been called a few hundred times with objects that fit
// EVERY CASE HAS A CLASS OR AN INTERFACE OF ITS OWN: a compiler that sees one misfit store to a class gives up on that field for the whole program, and every other case would then test nothing.
import type { WrittenProgram } from "../generate";

const written: WrittenProgram[] = [];

const head = `function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).map(key => key + ": " + describe(record[key])).join(", ") + "}";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}
// An error of the language (a member of null, a call of what is no function) is thrown by plain Bun too: its class is printed, not its text.
function say(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = describe(run());
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  console.log(label + ": " + line);
}
const names: string[] = ["x", "label", "next", "list", "flag"];
`;

type Holder = { file: string; name: string; declare: (n: string) => string; type: (n: string) => string; make: (n: string) => string };
const fieldsOf = (self: string) => `x: number; label: string; next: ${self} | null; list: number[]; flag: boolean`;
const literal = `{ x: 1, label: "p", next: null, list: [1, 2], flag: true }`;
const holders: Holder[] = [
  {
    file: "an-instance-of-a-class",
    name: "an instance of a class",
    declare: n => `class Point${n} {\n  x: number = 1;\n  label: string = "p";\n  next: Point${n} | null = null;\n  list: number[] = [1, 2];\n  flag: boolean = true;\n}`,
    type: n => `Point${n}`,
    make: n => `new Point${n}()`,
  },
  {
    file: "an-instance-whose-constructor-stores-its-parameters",
    name: "an instance whose constructor stores its parameters",
    declare: n => `class Account${n} {\n  next: Account${n} | null = null;\n  list: number[];\n  flag = true;\n  constructor(\n    public x: number,\n    public label: string,\n  ) {\n    this.list = [x, x + 1];\n  }\n}`,
    type: n => `Account${n}`,
    make: n => `new Account${n}(1, "p")`,
  },
  {
    file: "an-instance-of-a-class-below-another",
    name: "an instance of a class below another",
    declare: n => `class Base${n} {\n  x: number = 1;\n  label: string = "p";\n}\nclass Below${n} extends Base${n} {\n  next: Below${n} | null = null;\n  list: number[] = [1, 2];\n  flag: boolean = true;\n}`,
    type: n => `Below${n}`,
    make: n => `new Below${n}()`,
  },
  {
    file: "a-literal-typed-by-an-interface",
    name: "a literal typed by an interface",
    declare: n => `interface Shape${n} {\n  ${fieldsOf(`Shape${n}`).replaceAll("; ", ";\n  ")};\n}`,
    type: n => `Shape${n}`,
    make: () => literal,
  },
  {
    file: "a-literal-typed-by-an-alias",
    name: "a literal typed by an alias",
    declare: n => `type Entry${n} = { ${fieldsOf(`Entry${n}`)} };`,
    type: n => `Entry${n}`,
    make: () => literal,
  },
  {
    file: "what-a-function-with-a-declared-result-makes",
    name: "what a function with a declared result makes",
    declare: n => `interface Made${n} {\n  ${fieldsOf(`Made${n}`).replaceAll("; ", ";\n  ")};\n}\nfunction make${n}(x: number): Made${n} {\n  return { x, label: "p", next: null, list: [x, x + 1], flag: true };\n}`,
    type: n => `Made${n}`,
    make: n => `make${n}(1)`,
  },
  {
    file: "an-object-that-lies-in-a-field-of-another",
    name: "an object that lies in a field of another",
    declare: n => `class Inner${n} {\n  x: number = 1;\n  label: string = "p";\n  next: Inner${n} | null = null;\n  list: number[] = [1, 2];\n  flag: boolean = true;\n}\nclass Outer${n} {\n  inner: Inner${n} = new Inner${n}();\n}`,
    type: n => `Inner${n}`,
    make: n => `new Outer${n}().inner`,
  },
];

// What is read right behind the store: first in ways that no value makes throw, then as the type invites to.
const fields: Record<string, { misfits: string[]; gentle: string[]; direct: string[]; loop: { before: string; body: string; result: string } }> = {
  x: {
    misfits: [`"text"`, `null`, `undefined`, `{ valueOf() { return 7; } }`, `[3]`, `true`],
    gentle: ["typeof h.x", "h.x + 1", "h.x * 2", "h.x === 1", "h.x > 0"],
    direct: ["Math.abs(h.x)", "h.x | 0", "h.x.toFixed(1)"],
    loop: { before: "let total = 0;", body: "total += h.x;", result: "total" },
  },
  label: {
    misfits: [`7`, `null`, `{ toString() { return "o"; } }`, `["a", "b"]`],
    gentle: ["typeof h.label", 'h.label + "!"', 'h.label === "p"', "`<${h.label}>`"],
    direct: ["h.label.length", "h.label.toUpperCase()"],
    loop: { before: 'let text = "";', body: "text = h.label + round;", result: "text" },
  },
  next: {
    misfits: [`3`, `"text"`, `undefined`, `{ x: "s", label: 4 }`],
    gentle: ["typeof h.next", "h.next === null", "h.next == null", "h.next?.x"],
    direct: ["h.next!.x + 1", "h.next!.label.length"],
    loop: { before: "let linked = 0;", body: "if (h.next !== null) linked++;", result: "linked" },
  },
  list: {
    misfits: [`"ab"`, `{ length: 1, 0: 9 }`, `null`, `["a", null, 2]`],
    gentle: ["typeof h.list", "Array.isArray(h.list)", "h.list?.length", "h.list?.[0]"],
    direct: ["h.list[0]! + h.list[1]!", "h.list.map(each => each + 1)", "h.list.indexOf(2)"],
    loop: { before: "let total = 0;", body: "for (let index = 0; index < h.list.length; index++) total += h.list[index]!;", result: "total" },
  },
  flag: {
    misfits: [`0`, `""`, `"no"`, `null`, `{}`],
    gentle: ["typeof h.flag", 'h.flag ? "yes" : "no"', "!h.flag", "h.flag === true"],
    direct: ["h.flag && 1", "h.flag.valueOf()"],
    loop: { before: "let held = 0;", body: "if (h.flag) held++;", result: "held" },
  },
};

const ways: { name: string; text: (field: string, value: string, n: string) => string; declare?: (field: string, n: string) => string }[] = [
  { name: "by a store through any", text: (f, v) => `(h as any).${f} = ${v};` },
  { name: "by Reflect.set", text: (f, v) => `Reflect.set(h, "${f}", ${v});` },
  { name: "by Object.assign", text: (f, v) => `Object.assign(h, { ${f}: ${v} });` },
  { name: "by Object.defineProperty", text: (f, v) => `Object.defineProperty(h, "${f}", { value: ${v}, writable: true, enumerable: true, configurable: true });` },
  { name: "as what a getter answers", text: (f, v) => `Object.defineProperty(h, "${f}", { get() { return ${v}; }, enumerable: true, configurable: true });` },
  { name: "read-only and hidden", text: (f, v) => `Object.defineProperties(h, { ${f}: { value: ${v}, writable: false, enumerable: false, configurable: false } });` },
  { name: "by evaluated text", text: (f, v) => `new Function("o", "v", "o.${f} = v")(h, ${v});` },
  { name: "under a computed key", text: (f, v) => `(h as any)[names[${Object.keys(fields).indexOf(f)}]!] = ${v};` },
  { name: "through a wider type", text: (f, v) => `const wide = h as unknown as Record<string, unknown>;\n    wide.${f} = ${v};` },
  { name: "out of the entries of another object", text: (f, v) => `for (const [name, value] of Object.entries({ ${f}: ${v} })) (h as any)[name] = value;` },
  { name: "in a function that takes anything", declare: (f, n) => `function put${n}(o: any, v: any): void {\n  o.${f} = v;\n}`, text: (f, v, n) => `put${n}(h, ${v});` },
  { name: "from the prototype, the field deleted", text: (f, v) => `delete (h as any).${f};\n    Object.setPrototypeOf(h, { ${f}: ${v} });` },
  { name: "(deleted; the value is not used)", text: f => `delete (h as any).${f};` },
];

const tempos = ["once", "in-a-loop", "in-a-function-with-a-typed-parameter"] as const;
const firstLines: Record<(typeof tempos)[number], string> = {
  "once": "and the field is read right behind it, in the same function, by code that believes the type.",
  "in-a-loop": "in a loop that has read the field a few hundred times, and goes on reading it.",
  "in-a-function-with-a-typed-parameter": "and the object goes to a function with a typed parameter that has been called a few hundred times with objects that fit.",
};

let cases = 0;
holders.forEach((holder, holderIndex) => {
  for (const [tempoIndex, tempo] of tempos.entries()) {
    const parts: string[] = [];
    let pair = 0;
    for (const [field, { misfits, gentle, direct, loop }] of Object.entries(fields)) {
      for (const value of misfits) {
        pair++;
        ways.forEach((way, wayIndex) => {
          // Every way meets every value in one of the three programs about this kind of object, and in another one for the next kind.
          if ((wayIndex + pair + holderIndex) % tempos.length !== tempoIndex) return;
          if (way.text.length === 1 && value !== misfits[0]) return;
          const n = String(++cases);
          const label = `${field} gets ${value.replaceAll('"', "'")} ${way.name}`;
          const type = holder.type(n);
          const broken = way.text(field, value, n);
          const lines = [holder.declare(n), way.declare?.(field, n) ?? ""].filter(text => text !== "");
          if (tempo === "once") {
            for (const [how, reads] of [["", gentle], [", used as its type says", direct]] as const)
              lines.push(`say(${JSON.stringify(label + how)}, () => {\n    const h: ${type} = ${holder.make(n)};\n    ${broken}\n    return [${reads.join(", ")}, Object.keys(h).join()];\n});`);
          } else if (tempo === "in-a-loop") {
            lines.push(
              `say(${JSON.stringify(label)}, () => {\n    const h: ${type} = ${holder.make(n)};\n    ${loop.before}\n    for (let round = 0; round < 400; round++) {\n      if (round === 396) {\n    ${broken.replaceAll("\n", "\n    ")}\n      }\n      ${loop.body}\n    }\n    return [${loop.result}, Object.keys(h).join()];\n});`,
            );
          } else {
            lines.push(`function gentle${n}(h: ${type}): unknown[] {\n  return [${gentle.join(", ")}];\n}`, `function direct${n}(h: ${type}): unknown[] {\n  return [${direct.join(", ")}];\n}`);
            for (const reader of ["gentle", "direct"])
              lines.push(
                `say(${JSON.stringify(label + (reader === "direct" ? ", used as its type says" : ""))}, () => {\n    for (let round = 0; round < 400; round++) ${reader}${n}(${holder.make(n)});\n    const h: ${type} = ${holder.make(n)};\n    ${broken}\n    return ${reader}${n}(h);\n});`,
              );
          }
          parts.push(lines.join("\n"));
        });
      }
    }
    const first = `// GENERATED by ../generate-nothing-throws-because-of-a-type.ts. ${holder.name[0]!.toUpperCase()}${holder.name.slice(1)} gets a value that its field's type does not allow, in every way there is, ${firstLines[tempo]}\n// Nothing throws because of the type: the value is there, and the code does with it what plain Bun does.\n`;
    const entry = `${holder.file}-is-broken-${tempo}.ts`;
    written.push({ entry, files: { [entry]: first + head + "\n" + parts.join("\n\n") + "\n" } });
  }
});

export const programs = (): WrittenProgram[] => written;
