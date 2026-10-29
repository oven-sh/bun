// Two lists that are stored in different ways arrive at one parameter, and the first element is read there: in the function itself, in a function that it calls, in one that a built-in function calls, in a class.
// Every annotation of the parameter, in a checked file and under `// @ts-nocheck`, and JavaScript without one x every two lists x every place of the read: each once, twenty to a program, each in a block of its own.
// A checked file is only given lists that its annotation takes. A file that is not checked is given every list, so there the annotation may be wrong.

type Kind = "number" | "null" | "undefined" | "string" | "boolean" | "object";
const everyKind: readonly Kind[] = ["number", "null", "undefined", "string", "boolean", "object"];

const annotations: readonly { text: string; takes: readonly Kind[]; isReadOnly?: true }[] = [
  { text: "number[]", takes: ["number"] },
  { text: "(number | null)[]", takes: ["number", "null"] },
  { text: "(number | undefined)[]", takes: ["number", "undefined"] },
  { text: "(number | null | undefined)[]", takes: ["number", "null", "undefined"] },
  { text: "Array<number | null>", takes: ["number", "null"] },
  { text: "readonly (number | null)[]", takes: ["number", "null"], isReadOnly: true },
  { text: "(number | string)[]", takes: ["number", "string"] },
  { text: "(number | boolean)[]", takes: ["number", "boolean"] },
  { text: "(number | object)[]", takes: ["number", "object"] },
  { text: "unknown[]", takes: everyKind },
  { text: "any[]", takes: everyKind },
];

const lists: readonly { text: string; holds: readonly Kind[] }[] = [
  { text: "[1.5]", holds: ["number"] },
  { text: "[3]", holds: ["number"] },
  { text: "[1e-310]", holds: ["number"] },
  { text: "[-0]", holds: ["number"] },
  { text: "[NaN]", holds: ["number"] },
  { text: "[2 ** 31]", holds: ["number"] },
  { text: "[null]", holds: ["null"] },
  { text: "[undefined]", holds: ["undefined"] },
  { text: "[, 1.5]", holds: ["undefined", "number"] },
  { text: "[]", holds: [] },
  { text: '["x"]', holds: ["string"] },
  { text: "[true]", holds: ["boolean"] },
  { text: "[{}]", holds: ["object"] },
  { text: "[1.5, null]", holds: ["number", "null"] },
  { text: "[null, 1.5]", holds: ["number", "null"] },
  { text: '[1.5, "x"]', holds: ["number", "string"] },
];

/** The body of `f(a)`. `$LIST` and `$NUMBER` are what TypeScript needs there and JavaScript may not have. */
const reads: readonly { name: string; body: string; writes?: true }[] = [
  { name: "in the function", body: "return a[0];" },
  { name: "in an arrow that it calls", body: "const read = () => a[0]; return read();" },
  { name: "in an arrow called with call()", body: "return (() => a[0]).call(null);" },
  { name: "in a bound arrow", body: "return (() => a[0]).bind(null)();" },
  { name: "in an arrow for Reflect.apply", body: "return Reflect.apply(() => a[0], null, []);" },
  { name: "in an arrow for map()", body: "return [1].map(() => a[0])[0];" },
  { name: "in an arrow in an arrow for map()", body: "return [1].map(() => [1].map(() => a[0])[0])[0];" },
  { name: "in an arrow for flatMap()", body: "return [1].flatMap(() => [a[0]])[0];" },
  { name: "in an arrow for map() of a filled list", body: "return new Array(1).fill(0).map(() => a[0])[0];" },
  { name: "in an arrow for reduce()", body: "return [a[0], a[0]].reduce(() => a[0]);" },
  {
    name: "in an arrow for sort()",
    body: "const out$LIST = []; [2, 1].sort(() => (out.push(a[0]), 0)); return out[0];",
  },
  { name: "in an arrow for Array.from", body: "return Array.from({ length: 1 }, () => a[0])[0];" },
  { name: "in an arrow for Map.groupBy", body: "return [...Map.groupBy([1], () => a[0]).keys()][0];" },
  { name: "in a function for Map.groupBy", body: "return [...Map.groupBy([1], function () { return a[0]; }).keys()][0];" }, // prettier-ignore
  { name: "in an arrow for map() of a typed array", body: "return new Float64Array(1).map(() => a[0]$NUMBER)[0];" },
  { name: "in an arrow for replace()", body: 'return "x".replace("x", () => String(a[0]));' },
  { name: "in an arrow for JSON.parse", body: 'return JSON.parse("1", () => a[0]);' },
  {
    name: "in an arrow for a promise",
    body: "const out$LIST = []; void new Promise(() => out.push(a[0])); return out[0];",
  },
  { name: "in a field of a class", body: "return new (class { v = a[0]; })().v;" },
  { name: "in a static field of a class", body: "return class { static v = a[0]; }.v;" },
  { name: "in a static block of a class", body: "const out$LIST = []; void class { static { out.push(a[0]); } }; return out[0];" }, // prettier-ignore
  { name: "in a method of a class", body: "return new (class { read() { return a[0]; } })().read();" },
  { name: "in a getter of a literal", body: "return { get v() { return a[0]; } }.v;" },
  { name: "in the default of a parameter", body: "return ((x = a[0]) => x)();" },
  { name: "in a generator", body: "return [...(function* () { yield a[0]; })()][0];" },
  { name: "by for-of", body: "for (const x of a) return x; return undefined;" },
  { name: "by a pattern", body: "const [x] = a; return x;" },
  { name: "by at()", body: "return a.at(0);" },
  { name: "by find()", body: "return a.find(() => true);" },
  { name: "by forEach()", body: "const out$LIST = []; a.forEach(x => out.push(x)); return out[0];" },
  { name: "out of map()", body: "return a.map(x => x)[0];" },
  { name: "out of a spread", body: "return [...a][0];" },
  { name: "out of slice()", body: "return a.slice()[0];" },
  { name: "out of concat()", body: "return a.concat()[0];" },
  { name: "out of Array.from", body: "return Array.from(a)[0];" },
  { name: "out of Object.values", body: "return Object.values(a)[0];" },
  { name: "out of a set", body: "return [...new Set(a)][0];" },
  { name: "by pop()", body: "return a.pop();", writes: true },
  { name: "behind a push of it", body: "a.push(a[0]$ELEMENT); return a[a.length - 1];", writes: true },
  { name: "behind a store of it", body: "a[0] = a[0]$ELEMENT; return (() => a[0])();", writes: true },
];

type Form = { annotation?: (typeof annotations)[number]; isChecked: boolean };
const forms: readonly Form[] = [
  { isChecked: false },
  ...annotations.flatMap(annotation => [
    { annotation, isChecked: false },
    { annotation, isChecked: true },
  ]),
];

function casesOf({ annotation, isChecked }: Form) {
  const given = lists.filter(list => !isChecked || list.holds.every(kind => annotation!.takes.includes(kind)));
  const places = reads.filter(read => !(isChecked && annotation!.isReadOnly && read.writes));
  const pairs = given.flatMap(first =>
    given.filter(second => second !== first).map(second => [first, second] as const),
  );
  // One pair after the other within one place would give a program one place alone: so the place moves fastest.
  return { count: pairs.length * places.length, at: (n: number) => ({ pair: pairs[Math.floor(n / places.length)], read: places[n % places.length] }) }; // prettier-ignore
}

export const inOne = 20;
const laidOut = forms.map(form => ({ form, cases: casesOf(form) }));
export const programs = laidOut.reduce((sum, { cases }) => sum + Math.ceil(cases.count / inOne), 0);

export function programOf(index: number): { file: string; text: string } {
  let first = index;
  const { form, cases } = laidOut.find(({ cases }) => first < Math.ceil(cases.count / inOne) || ((first -= Math.ceil(cases.count / inOne)), false))!; // prettier-ignore
  const isTyped = !!form.annotation;
  const typed = (text: string, type: string) => (isTyped ? text + type : text);
  const blocks = Array.from({ length: Math.min(cases.count, (first + 1) * inOne) - first * inOne }, (_, at) => {
    const { pair, read } = cases.at(first * inOne + at);
    const body = read.body
      .replaceAll("$LIST", isTyped ? ": unknown[]" : "")
      .replaceAll("$NUMBER", isTyped ? " as number" : "")
      .replaceAll("$ELEMENT", isTyped ? " as never" : "");
    const label = `${form.annotation?.text ?? "no annotation"}, ${form.isChecked ? "checked" : "not checked"} | ${pair[0].text} ${pair[1].text} | ${read.name}`;
    return `{
  function f(${typed("a", `: ${form.annotation?.text}`)}) { ${body} }
  say(${JSON.stringify(label)}, () => [f(${pair[0].text}), f(${pair[1].text})]);
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
