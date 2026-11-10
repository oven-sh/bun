// `const [a, b = f(), c = 5] = list` walks the list step by step: each name takes one step of the iterator, and a default
// runs between two steps. The compiler may read the elements by position instead. Then what runs between the steps matters:
// in each scene a default, a nested pattern, a computed target or a getter changes the list that is being walked. It grows,
// shrinks, gets a hole or another kind of element. A walk that has come to the end stays at the end.
import type { Random } from "./random";

/** Expressions that change `list` and give a value. */
const changes = [
  "(list.push(7), 70)",
  "(list.push(7, 8), 70)",
  "(list.pop(), 70)",
  "(list.shift(), 70)",
  "(list.unshift(9), 70)",
  "((list.length = 0), 70)",
  "((list.length = 1), 70)",
  "((list.length = 6), 70)",
  "((list[2] = 30), 70)",
  "((list[1] = 20), 70)",
  '((list[2] = "text"), 70)',
  "((list[2] = 0.5), 70)",
  "(delete list[2], 70)",
  "(list.reverse(), 70)",
  "(list.splice(1, 1), 70)",
  "(list.fill(4), 70)",
  "grow(list)",
  "((list[5000] = 1), 70)",
  "(Object.freeze(list), 70)",
  "70",
];

/** Statements that take `list` apart. CHANGE is one of the expressions above. */
const patterns = [
  "const [a, b = CHANGE, c = 5] = list;\n  return [a, b, c];",
  "const [a = CHANGE, b, c = 5] = list;\n  return [a, b, c];",
  "const [a, b = CHANGE, c = 5, d = 6] = list;\n  return [a, b, c, d];",
  'const [a, b = CHANGE, ...rest] = list;\n  return [a, b, rest.length, rest.join("+")];',
  "const [a = CHANGE, , c = 5] = list;\n  return [a, c];",
  "const [a, [b] = [CHANGE], c = 5] = list;\n  return [a, b, c];",
  "const [a, { x = CHANGE } = {}, c = 5] = list;\n  return [a, x, c];",
  "const [a, b = CHANGE, c = CHANGE2, d = 6] = list;\n  return [a, b, c, d];",
  "let a, b, c;\n  [a, b = CHANGE, c = 5] = list;\n  return [a, b, c];",
  'const out = {};\n  [out.a, out[(CHANGE, "b")], out.c = 5] = list;\n  return [out.a, out.b, out.c];',
  "const out = [];\n  [out[0], out[1] = CHANGE, out[2] = 5] = list;\n  return out;",
  "[list[2], list[0] = CHANGE, list[1] = 5] = list;\n  return [];",
  "const target = {\n    set a(value) {\n      CHANGE;\n    },\n  };\n  let c;\n  [target.a, c = 5] = list;\n  return [c];",
  "const take = ([a, b = CHANGE, c = 5]) => [a, b, c];\n  return take(list);",
  "function take(a, [b, c = CHANGE, d = 5]) {\n    return [a, b, c, d];\n  }\n  return take(0, list);",
  "for (const [a, b = CHANGE, c = 5] of [list, list]) seen.push(a, b, c);\n  return seen.splice(0);",
  "const [a, b = CHANGE] = list;\n  const [c, d = 5, e = 6] = list;\n  return [a, b, c, d, e];",
];

const lists = [
  "[1]",
  "[1, undefined]",
  "[1, undefined, 3]",
  "[1, 2, 3]",
  "[]",
  "[undefined]",
  "[1, , 3]",
  "[1.5, undefined, 3.5]",
  '["a", undefined, "c"]',
  "[1, undefined, undefined, 4]",
  "given",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(4, 8); scene < total; scene++) {
    const body = random
      .pick(patterns)
      .replaceAll("CHANGE2", random.pick(changes))
      .replaceAll("CHANGE", random.pick(changes));
    scenes.push(`function scene${scene}(given) {
  const list = ${random.pick(lists)};
  const taken = told(() => {
  ${body.replaceAll("\n", "\n  ")}
  });
  return shown(taken) + " of " + shown(list);
}
{
  let last;
  for (let round = 0; round < ${random.pick([1, 1, 3, 300])}; round++) last = noted([scene${scene}([1]), scene${scene}([1, undefined, 3]), scene${scene}([4, 5, 6, 7])].join(" | "));
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set();
function noted(answer) {
  rounds.add(answer);
  return answer;
}
function counted() {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const seen = [];
function grow(list) {
  list.push(11, 12);
  return 71;
}
function shown(value) {
  if (!Array.isArray(value)) return String(value);
  const parts = [];
  for (let at = 0; at < Math.min(value.length, 9); at++) parts.push(at in value ? String(value[at]) : "hole");
  return value.length + "[" + parts.join() + "]";
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
