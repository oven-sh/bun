// A function reads a field, an element or a method, does something, and reads it again. The compiler may answer the second
// read from the first unless something between them can have written it. In each scene something does, in a way that is
// easy to overlook: a store through another name for the same object, a getter in a literal that writes, an argument whose
// evaluation replaces the method that is about to be called, a setter, a copy, a callback, overlapping views of one buffer.
// In some calls the two names really are one object and in others they are not.
import type { Random } from "./random";

/** Bodies of `function NAME(a, b, list, n)`. They return what both reads saw. */
const bodies = [
  'const first = a.x;\n  b.x = n;\n  return first + "," + a.x;',
  'const first = a.x;\n  b.x = n;\n  b.y = n + 1;\n  return first + "," + a.x + "," + a.y;',
  'const first = a.x;\n  list[0].x = n;\n  return first + "," + a.x;',
  'const first = a.x;\n  holder.it.x = n;\n  return first + "," + a.x;',
  'const first = a.inner.x;\n  b.inner = { x: n };\n  return first + "," + a.inner.x;',
  'const first = a.inner.x;\n  b.inner.x = n;\n  return first + "," + a.inner.x;',
  'let sum = 0;\n  for (let i = 0; i < 4; i++) {\n    sum += a.x;\n    b.x = sum + n;\n  }\n  return sum + "," + a.x;',
  'const first = a.x;\n  if (n > 1) b.x = n;\n  return first + "," + a.x;',
  'const first = a.x;\n  Object.assign(b, { x: n });\n  return first + "," + a.x;',
  'const first = a.x;\n  delete b.x;\n  return first + "," + a.x;',
  'const first = a.x;\n  b[key("x")] = n;\n  return first + "," + a.x;',
  'const first = a.x;\n  [n].forEach(value => {\n    b.x = value;\n  });\n  return first + "," + a.x;',
  // A getter of a literal writes what is read around it.
  'const first = a.x;\n  const got = writer.touch;\n  return first + "," + got + "," + a.x;',
  'const first = shared.x;\n  const got = writer.touch;\n  return first + "," + got + "," + shared.x;',
  'return shared.x + "," + writer.touch + "," + shared.x;',
  'const first = shared.x;\n  writer.put = n;\n  return first + "," + shared.x;',
  // The method is read before the arguments are evaluated.
  'return a.m((a.m = () => "replaced")) + "," + a.m();',
  'return a.m(swap(a)) + "," + a.m();',
  'return a.m(b.m = () => "replaced") + "," + a.m();',
  'const method = a.m;\n  a.m = () => "replaced";\n  return method.call(a) + "," + a.m();',
  'return a.inner.m?.(delete a.inner.m) + "," + typeof a.inner.m;',
  'return Tool.twice(replaceTwice(n)) + "," + Tool.twice(n);',
  'return Tool.twice((Tool.twice = value => "replaced " + value), n) + "," + Tool.twice(n);',
  'return tools.twice(replaceInTools(n)) + "," + tools.twice(n);',
  // A getter of a literal changes a list of numbers, but only at a late call.
  'const first = numbers[0] + numbers[1];\n  const got = late.touch;\n  return first + "," + got + "," + (numbers[0] + numbers[1]);',
  "let sum = 0;\n  for (let i = 0; i < numbers.length; i++) {\n    sum += numbers[i];\n    if (i === 0) sum += late.touch;\n  }\n  return String(sum);",
  'const made = makeLate();\n  const first = numbers[2];\n  const got = made.touch + made.touch;\n  return first + "," + got + "," + numbers[2];',
  // Elements.
  'const first = list[1];\n  other[1] = n;\n  return first + "," + list[1];',
  'const first = list.length;\n  other.push(n);\n  return first + "," + list.length;',
  'const first = list[1];\n  other.length = 1;\n  return first + "," + list[1];',
  'const first = bytes[0];\n  words[0] = n * 257;\n  return first + "," + bytes[0] + "," + bytes[1];',
  'const first = bytes[4];\n  part[0] = n;\n  return first + "," + bytes[4];',
  // What a test has shown does not outlast a write either.
  'if (typeof a.x !== "number") return "no number";\n  b.x = "text";\n  return a.x + 1;',
  'if (a.inner === null) return "null";\n  b.inner = null;\n  return told(() => a.inner.x);',
  'if (!Array.isArray(a.list)) return "no list";\n  b.list = { length: "none" };\n  return String(a.list.length);',
  'if (!("x" in a)) return "absent";\n  delete b.x;\n  return String(a.x);',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const rounds = random.pick([1, 1, 3, 300]);
    // In the rounds that come first the names may be apart, so that what is learned there is wrong later.
    const order = random.pick(["same, apart", "apart, same", "apart, apart, same", "same"]);
    scenes.push(`function scene${scene}(a, b, list, other, n) {
  holder.it = b;
  shared.x = 1;
  Tool.twice = twice;
  tools.twice = twice;
  ${random.pick(bodies)}
}
{
  // Some writes only come in a late round, so every distinct answer is kept, not the last one alone.
  const distinct = new Set();
  for (let round = 0; round < ${rounds}; round++) {
    const answers = [];
    for (const kind of ${JSON.stringify(order.split(", "))}) {
      const a = make();
      const b = kind === "same" ? a : make();
      const list = [a, 2, 3];
      if (kind === "same") list[0] = b;
      answers.push(kind + " " + told(() => scene${scene}(a, b, list, kind === "same" ? list : [b, 2, 3], ${random.pick(["2", "5", "0.5", "-1"])})));
    }
    distinct.add(answers.join(" | "));
  }
  console.log("scene ${scene}", [...distinct].slice(0, 6).join(" || "));
}`);
  }
  return `const key = name => process.argv[9] ?? name;
const holder = { it: null };
const shared = { x: 1 };
const writer = {
  get touch() {
    shared.x += 10;
    if (holder.it) holder.it.x = 77;
    return "touched";
  },
  set put(value) {
    shared.x = value;
  },
};
const buffer = new ArrayBuffer(16);
const bytes = new Uint8Array(buffer);
const words = new Uint16Array(buffer);
const part = bytes.subarray(4);
const twice = value => value * 2;
class Tool {
  static twice = twice;
}
const tools = { twice };
function replaceTwice(value) {
  Tool.twice = given => "replaced " + given;
  return value;
}
function replaceInTools(value) {
  tools.twice = given => "replaced " + given;
  return value;
}
const numbers = [1.5, 2.5, 3.5];
let touches = 0;
function makeLate() {
  return {
    get touch() {
      if (++touches % 50 === 0) numbers[touches % 3] = touches % 100 ? "text" : 4.5;
      return 1;
    },
  };
}
const late = makeLate();
function make() {
  return { x: 1, y: 2, inner: { x: 3, m: () => "inner" }, list: [1, 2], m: () => "first" };
}
function swap(it) {
  it.m = () => "swapped";
  return 0;
}
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
