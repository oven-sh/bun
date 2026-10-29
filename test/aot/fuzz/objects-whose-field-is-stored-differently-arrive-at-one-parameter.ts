// Two objects whose field `v` holds values of different kinds arrive at one parameter, and the field is read there: in the function itself, in a function that it calls, in one that a built-in function calls, in a class.
// Every way to hold the field x every annotation of it, in a checked file and under `// @ts-nocheck`, and JavaScript without one x every two values x every place of the read: each once, twenty to a program, each in a block of its own.
// A checked file is only given values that its annotation takes. A file that is not checked is given every value, so there the annotation may be wrong.

type Kind = "number" | "null" | "undefined" | "string" | "boolean" | "object" | "absent";
const everyKind: readonly Kind[] = ["number", "null", "undefined", "string", "boolean", "object"];

const annotations: readonly { text: string; takes: readonly Kind[] }[] = [
  { text: "number", takes: ["number"] },
  { text: "number | null", takes: ["number", "null"] },
  { text: "number | undefined", takes: ["number", "undefined"] },
  { text: "number | null | undefined", takes: ["number", "null", "undefined"] },
  { text: "number | string", takes: ["number", "string"] },
  { text: "number | boolean", takes: ["number", "boolean"] },
  { text: "number | object", takes: ["number", "object"] },
  { text: "unknown", takes: everyKind },
  { text: "any", takes: everyKind },
];

/** `declares` stands in the block ahead of `f`; `$T` is the annotation with its colon, or nothing in JavaScript. */
const holders: readonly {
  name: string;
  declares?: string;
  type: (annotation: string) => string;
  make: (value: string | undefined) => string;
  mayLackIt?: true;
}[] = [
  { name: "a literal", type: t => `{ v: ${t} }`, make: value => `{ v: ${value} }` },
  { name: "a literal that may lack it", type: t => `{ v?: ${t} }`, make: value => (value === undefined ? "{}" : `{ v: ${value} }`), mayLackIt: true }, // prettier-ignore
  {
    name: "a literal with a number ahead",
    type: t => `{ u: number; v: ${t} }`,
    make: value => `{ u: 1, v: ${value} }`,
  },
  {
    name: "a literal with a fraction behind",
    type: t => `{ v: ${t}; w: number }`,
    make: value => `{ v: ${value}, w: 0.5 }`,
  },
  { name: "an instance", declares: "class Holder { v$T; constructor(v$T) { this.v = v; } }", type: () => "Holder", make: value => `new Holder(${value})` }, // prettier-ignore
];

const values: readonly { text?: string; kind: Kind }[] = [
  { text: "1.5", kind: "number" },
  { text: "3", kind: "number" },
  { text: "1e-310", kind: "number" },
  { text: "-0", kind: "number" },
  { text: "NaN", kind: "number" },
  { text: "2 ** 31", kind: "number" },
  { text: "null", kind: "null" },
  { text: "undefined", kind: "undefined" },
  { text: '"x"', kind: "string" },
  { text: "true", kind: "boolean" },
  { text: "{}", kind: "object" },
  { kind: "absent" },
];

/** The body of `f(a)`. `$LIST`, `$NUMBER` and `$VALUE` are what TypeScript needs there and JavaScript may not have. */
const reads: readonly { name: string; body: string }[] = [
  { name: "in the function", body: "return a.v;" },
  { name: "by a key in brackets", body: 'return a["v"];' },
  { name: "in an arrow that it calls", body: "const read = () => a.v; return read();" },
  { name: "in an arrow called with call()", body: "return (() => a.v).call(null);" },
  { name: "in a bound arrow", body: "return (() => a.v).bind(null)();" },
  { name: "in an arrow for Reflect.apply", body: "return Reflect.apply(() => a.v, null, []);" },
  { name: "in an arrow for map()", body: "return [1].map(() => a.v)[0];" },
  { name: "in an arrow in an arrow for map()", body: "return [1].map(() => [1].map(() => a.v)[0])[0];" },
  { name: "in an arrow for flatMap()", body: "return [1].flatMap(() => [a.v])[0];" },
  { name: "in an arrow for map() of a filled list", body: "return new Array(1).fill(0).map(() => a.v)[0];" },
  { name: "in an arrow for reduce()", body: "return [a.v, a.v].reduce(() => a.v);" },
  {
    name: "in an arrow for sort()",
    body: "const out$LIST = []; [2, 1].sort(() => (out.push(a.v), 0)); return out[0];",
  },
  { name: "in an arrow for Array.from", body: "return Array.from({ length: 1 }, () => a.v)[0];" },
  { name: "in an arrow for Map.groupBy", body: "return [...Map.groupBy([1], () => a.v).keys()][0];" },
  {
    name: "in a function for Map.groupBy",
    body: "return [...Map.groupBy([1], function () { return a.v; }).keys()][0];",
  },
  { name: "in an arrow for map() of a typed array", body: "return new Float64Array(1).map(() => a.v$NUMBER)[0];" },
  { name: "in an arrow for replace()", body: 'return "x".replace("x", () => String(a.v));' },
  { name: "in an arrow for JSON.parse", body: 'return JSON.parse("1", () => a.v);' },
  {
    name: "in an arrow for a promise",
    body: "const out$LIST = []; void new Promise(() => out.push(a.v)); return out[0];",
  },
  { name: "in a field of a class", body: "return new (class { w = a.v; })().w;" },
  { name: "in a static field of a class", body: "return class { static w = a.v; }.w;" },
  { name: "in a static block of a class", body: "const out$LIST = []; void class { static { out.push(a.v); } }; return out[0];" }, // prettier-ignore
  { name: "in a method of a class", body: "return new (class { read() { return a.v; } })().read();" },
  { name: "in a getter of a literal", body: "return { get w() { return a.v; } }.w;" },
  { name: "in the default of a parameter", body: "return ((x = a.v) => x)();" },
  { name: "in a generator", body: "return [...(function* () { yield a.v; })()][0];" },
  { name: "into a list", body: "return [a.v][0];" },
  { name: "into a list beside a fraction", body: "return [0.5, a.v][1];" },
  { name: "into a literal", body: "return { w: a.v }.w;" },
  { name: "by a pattern", body: "const { v } = a; return v;" },
  { name: "by a pattern in an arrow", body: "return (({ v }$HOLDER) => v)(a);" },
  { name: "by Reflect.get", body: 'return Reflect.get(a, "v");' },
  { name: "by its descriptor", body: 'return Object.getOwnPropertyDescriptor(a, "v")?.value;' },
  { name: "by for-in", body: 'for (const key in a) if (key === "v") return a[key]; return undefined;' },
  { name: "out of a spread", body: "return { ...a }.v;" },
  { name: "out of Object.assign", body: "return Object.assign({}, a).v;" },
  { name: "out of Object.entries", body: 'return Object.entries(a).find(([key]) => key === "v")?.[1];' },
  { name: "out of a copy", body: "return structuredClone({ ...a }).v;" },
  { name: "as JSON", body: "return JSON.stringify({ ...a });" },
  { name: "behind a store of it", body: "a.v = a.v$VALUE; return (() => a.v)();" },
];

type Form = { holder: (typeof holders)[number]; annotation?: (typeof annotations)[number]; isChecked: boolean };
const forms: readonly Form[] = holders.flatMap(holder => [
  { holder, isChecked: false },
  ...annotations.flatMap(annotation => [
    { holder, annotation, isChecked: false },
    { holder, annotation, isChecked: true },
  ]),
]);

function casesOf({ holder, annotation, isChecked }: Form) {
  const given = values.filter(value => (value.kind === "absent" ? !!holder.mayLackIt : !isChecked || annotation!.takes.includes(value.kind))); // prettier-ignore
  const pairs = given.flatMap(first =>
    given.filter(second => second !== first).map(second => [first, second] as const),
  );
  // One pair after the other within one place would give a program one place alone: so the place moves fastest.
  return { count: pairs.length * reads.length, at: (n: number) => ({ pair: pairs[Math.floor(n / reads.length)], read: reads[n % reads.length] }) }; // prettier-ignore
}

export const inOne = 20;
const laidOut = forms.map(form => ({ form, cases: casesOf(form) }));
export const programs = laidOut.reduce((sum, { cases }) => sum + Math.ceil(cases.count / inOne), 0);

export function programOf(index: number): { file: string; text: string } {
  let first = index;
  const { form, cases } = laidOut.find(({ cases }) => first < Math.ceil(cases.count / inOne) || ((first -= Math.ceil(cases.count / inOne)), false))!; // prettier-ignore
  const { holder, annotation } = form;
  const isTyped = !!annotation;
  const typed = (text: string, type: string) => (isTyped ? text + type : text);
  const type = isTyped ? holder.type(annotation.text) : "";
  const blocks = Array.from({ length: Math.min(cases.count, (first + 1) * inOne) - first * inOne }, (_, at) => {
    const { pair, read } = cases.at(first * inOne + at);
    const body = read.body
      .replaceAll("$LIST", isTyped ? ": unknown[]" : "")
      .replaceAll("$NUMBER", isTyped ? " as number" : "")
      .replaceAll("$VALUE", isTyped ? " as never" : "")
      .replaceAll("$HOLDER", isTyped ? `: ${type}` : "");
    const label = `${holder.name}, ${annotation?.text ?? "no annotation"}, ${form.isChecked ? "checked" : "not checked"} | ${pair[0].text ?? "absent"} . ${pair[1].text ?? "absent"} | ${read.name}`;
    return `{${holder.declares ? `\n  ${holder.declares.replaceAll("$T", isTyped ? `: ${annotation.text}` : "")}` : ""}
  function f(${typed("a", `: ${type}`)}) { ${body} }
  say(${JSON.stringify(label)}, () => [f(${holder.make(pair[0].text)}), f(${holder.make(pair[1].text)})]);
}`;
  });
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: `${isTyped && !form.isChecked ? "// @ts-nocheck\n" : ""}const show = (${typed("value", ": unknown")}) => (Object.is(value, -0) ? "number -0" : typeof value + " " + String(value));
const say = (${typed("label", ": string")}, ${typed("run", ": () => unknown[]")}) => {
  let line;
  try {
    line = run().map(show).join(" . ");
  } catch (error) {
    line = "THROWS " + String(error);
  }
  console.log(label + ": " + line);
};
${blocks.join("\n")}
${isTyped ? "export {};\n" : ""}`,
  };
}
