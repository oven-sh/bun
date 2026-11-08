// A class extends a built-in or host class (Date, RegExp, Promise, a typed array, EventTarget, URL ..) and functions,
// fields and lists are typed with it. At run time some values are not what the type says: a plain object of the built-in
// class, an object of a sibling class, an object that only has the class's prototype, or something else entirely. They
// arrive through `any`, a cast, a list or a field. Every test and every member access must answer for the value that is
// really there, as it does in plain JavaScript.
import type { Random } from "./random";

/** `args` constructs the base, `own` reads something only real objects of the base can answer. */
const bases: Record<string, { type?: string; args: string; own: string }> = {
  Date: { args: "0", own: "x.getTime()" },
  RegExp: { args: '"a"', own: "x.source" },
  Promise: { type: "Promise<number>", args: "() => {}", own: "typeof x.then(() => 1)" },
  Uint8Array: { args: "2", own: "x.length" },
  Float64Array: { args: "2", own: "x.byteLength" },
  ArrayBuffer: { args: "8", own: "x.byteLength" },
  DataView: { type: "DataView<ArrayBuffer>", args: "new ArrayBuffer(8)", own: "x.byteLength" },
  Map: { type: "Map<string, number>", args: "", own: "x.size" },
  Set: { type: "Set<number>", args: "", own: "x.size" },
  Error: { args: '"e"', own: "x.message" },
  Array: { type: "Array<number>", args: "", own: "x.length" },
  EventTarget: { args: "", own: 'x.dispatchEvent(new Event("e"))' },
  URL: { args: '"http://a/b"', own: "x.pathname" },
  URLSearchParams: { args: '"a=1"', own: 'x.get("a")' },
  Headers: { args: "", own: 'x.has("a")' },
  AbortController: { args: "", own: "x.signal.aborted" },
};

/** Expressions for a value that is not an object of class NAME. BASE is what NAME extends, OTHER a sibling class. */
const strangers = [
  "new BASE(ARGS)",
  "new OTHER()",
  "Object.create(NAME.prototype)",
  "Object.setPrototypeOf(new BASE(ARGS), NAME.prototype)",
  "Object.setPrototypeOf(new NAME(), BASE.prototype)",
  "Object.setPrototypeOf(new NAME(), OTHER.prototype)",
  '{ extra: 7, tag: () => "look-alike" }',
  "new Proxy(new NAME(), {})",
  "Reflect.construct(BASE, [ARGS], NAME)",
  "Reflect.construct(NAME, [], OTHER)",
  "null",
  "undefined",
  "5",
];

/** Expressions about `x`, typed as NAME. */
const questions = [
  "x instanceof NAME",
  "x instanceof BASE",
  "x.extra",
  "x.tag()",
  "typeof x.tag",
  "x.twice()",
  "OWN",
  "x.constructor === NAME",
  "Object.getPrototypeOf(x) === NAME.prototype",
  '"extra" in x',
  "isNAME(x)",
  "Object.keys(x).join()",
  "((x.extra = 9), x.extra)",
  "x.extra + 1",
  "NAME.prototype.tag.call(x)",
];

/** How the value reaches a place typed NAME. ASK is the function with the questions, VALUE the expression. */
const routes = [
  "ASK(VALUE as any)",
  "ASK(VALUE as unknown as NAME)",
  "ASK(pass(VALUE))",
  "([VALUE] as unknown as NAME[]).map(ASK)[0]",
  "ASK(({ held: VALUE } as unknown as { held: NAME }).held)",
  "((list: NAME[]) => ASK(list[list.length - 1]))([new NAME(), VALUE as any])",
  'ASK(JSON.parse("[0]").map(() => (VALUE))[0])',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(1, 3); scene < total; scene++) {
    const name = `C${scene}`;
    const baseName = random.pick(Object.keys(bases));
    const base = bases[baseName];
    const filled = (text: string) =>
      text
        .replaceAll("OWN", base.own)
        .replaceAll("NAME", name)
        .replaceAll("OTHER", `D${scene}`)
        .replaceAll("BASE", baseName)
        .replaceAll("ARGS", base.args)
        .replaceAll("ASK", `ask${scene}`);
    const asked = random.sample(questions, random.between(3, 7)).map(filled);
    const warm = random.pick([0, 1, 300, 5000]);
    const extended = base.type ?? baseName;
    scenes.push(`class ${name} extends ${extended} {
  extra = 5;
  constructor() {
    super(${base.args});
  }
  tag(): string {
    return "${name}";
  }
  twice(): number {
    return this.extra * 2;
  }
}
class D${scene} extends ${extended} {
  different = "d";
  constructor() {
    super(${base.args});
  }
  tag(): string {
    return "D${scene}";
  }
}
function is${name}(x: unknown): x is ${name} {
  return x instanceof ${name};
}
function ask${scene}(x: ${name}): string {
  return [${asked.map(question => `told(() => ${question})`).join(", ")}].join();
}
${warm ? `for (let i = 0; i < ${warm}; i++) ask${scene}(new ${name}());\n` : ""}console.log("scene ${scene} real", ask${scene}(new ${name}()));
${random
  .sample(strangers, random.between(2, 5))
  .map(
    stranger => `console.log("scene ${scene}", told(() => ${filled(random.pick(routes).replace("VALUE", stranger))}));`,
  )
  .join("\n")}
console.log("scene ${scene} real again", ask${scene}(new ${name}()));`);
  }
  return `const pass = (value: unknown): any => value;
function told(ask: () => unknown): unknown {
  try {
    return ask();
  } catch (error) {
    return "threw " + (error as Error).name;
  }
}
${scenes.join("\n")}
`;
}
