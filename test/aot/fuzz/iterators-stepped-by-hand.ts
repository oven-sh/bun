// `const it = list[Symbol.iterator](); for (let r = it.next(); !r.done; r = it.next())`: an iterator of a list that a program
// steps by hand. A compiler may leave such an iterator unmade and keep only its position, as long as nothing else looks at it.
// Each scene varies what that rests on: the list changes under the walk, the walk ends and the list grows again, and the iterator
// is seen after all: handed on, compared, spread, stepped by a saved `next`, or given a field, sometimes on one turn in many.
import type { Random } from "./random";

const lists = [
  "[1, 2, 3, 4]",
  "[1, 2, 3, 4]",
  "[]",
  "[7]",
  "[1.5, 2.5, 3.5]",
  '["a", "b", "c"]',
  "[{ v: 1 }, { v: 2 }]",
  "[1, , 3]",
  "Array.from({ length: 6 }, (_, at) => at * at)",
  "new Array(3)",
  '"a,b,c".split(",")',
  "new Sub(1, 2, 3)",
  "Object.assign([1, 2], { extra: 1 })",
  "[1, 2, 3].map(each => each + 1)",
];

const makers = ["list[Symbol.iterator]()", "list[Symbol.iterator]()", "list.values()", "list.keys()", "list.entries()"];

const changes = [
  "list.push(9)",
  "list.pop()",
  "list.length = 1",
  "list.length = 0",
  "list[at + 1] = 50",
  "list.shift()",
  "list.unshift(0)",
  "list.reverse()",
  "delete list[at + 1]",
  "list = [100, 200, 300]",
  "list.length = 9",
  "list[20] = 1",
];

/** Ways to see the iterator. IT is the iterator as any. */
const looks = [
  "said += Object.prototype.toString.call(IT);",
  "said += IT[Symbol.iterator]() === IT;",
  "said += typeof IT.next;",
  "said += Object.getPrototypeOf(IT) === Object.getPrototypeOf([].values());",
  "said += Object.keys(IT).length;",
  "IT.extra = 1; said += IT.extra + Object.keys(IT).join();",
  "said += JSON.stringify([...IT]);",
  "said += JSON.stringify(Array.from(IT));",
  "for (const each of IT) { said += String(each); break; }",
  "for (const each of IT) said += String(each);",
  "said += JSON.stringify(IT.map((each: EACH) => [each]).toArray());",
  "said += JSON.stringify(IT.drop(1).toArray());",
  "said += stepOnce(IT);",
  "held.it = IT; said += held.it.next().value;",
  "const next = IT.next; said += next.call(IT).value;",
  "const next = IT.next; said += next.call([5, 6].values()).value;",
  "const next = IT.next; said += next.call(list).value;",
  "said += String(IT);",
  "said += JSON.stringify(IT);",
  "said += IT instanceof Iterator;",
  "said += new Map([[IT, 1]]).get(IT);",
  "const again = () => IT.next().value; said += again();",
  'said += "return" in IT;',
  "said += typeof IT.return;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const itAny = typed ? "(it as any)" : "it";
  const failure = typed ? "(error as Error).name" : "error.name";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const list = random.pick(lists);
    const maker = random.pick(makers);
    const change = isPlain || random.chance(0.4) ? "" : random.pick(changes);
    const look =
      isPlain || random.chance(0.4)
        ? ""
        : random
            .pick(looks)
            .replace(/\bIT\b/g, itAny)
            .replace(": EACH", typed ? ": unknown" : "");
    const changeAt = random.below(4);
    const lookAt = random.below(4);
    const seldom = random.pick([1, 1, 3, 7, 25]);
    const form = isPlain ? "for" : random.pick(["for", "for", "while", "pattern", "double", "try", "closure"]);
    const inside = `said += String(typeof value === "object" ? JSON.stringify(value) : value) + ",";
      ${change ? `if (at === ${changeAt} && turn % ${seldom} === 0) { ${change}; }` : ""}
      ${look ? `if (at === ${lookAt} && turn % ${seldom} === 0) { ${look} }` : ""}
      if (++at > 40) break;`;
    const walk =
      form === "for"
        ? `for (let r = it.next(); !r.done; r = it.next()) {
      const value = r.value;
      ${inside}
    }`
        : form === "while"
          ? `while (true) {
      const r = it.next();
      if (r.done) break;
      const value = r.value;
      ${inside}
    }`
          : form === "pattern"
            ? `for (let { done, value } = it.next(); !done; { done, value } = it.next()) {
      ${inside}
    }`
            : form === "double"
              ? `for (let r = it.next(); !r.done; r = it.next()) {
      const skipped = it.next();
      const value = [r.value, skipped.value, skipped.done];
      ${inside}
    }`
              : form === "try"
                ? `try {
      for (let r = it.next(); !r.done; r = it.next()) {
        const value = r.value;
        if (at === ${changeAt} && turn % ${seldom + 1} === 0) throw new RangeError("rare");
        ${inside}
      }
    } catch (error) {
      said += "caught " + ${failure} + " " + JSON.stringify(it.next());
    } finally {
      said += "end";
    }`
                : `const step = () => it.next();
    for (let r = step(); !r.done; r = step()) {
      const value = r.value;
      ${inside}
    }`;
    const after = random.chance(0.4)
      ? `list.push(77);
    said += JSON.stringify(it.next());`
      : "";
    const turns = random.pick([6, 40, 300, 2000]);
    scenes.push(`function walk${scene}(turn${as("number")}) {
  let said = "";
  let at = 0;
  const held${as("{ it?: any }")} = {};
  let list${as("any[]")} = ${list};
  const it = ${maker};
  try {
    ${walk}
    ${after}
  } catch (error) {
    said += "threw " + ${failure};
  }
  return said + JSON.stringify(list.length);
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    last = walk${scene}(turn);
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `class Sub extends Array${typed ? "<any>" : ""} {}
function stepOnce(given${as("any")}) {
  return JSON.stringify(given.next());
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
