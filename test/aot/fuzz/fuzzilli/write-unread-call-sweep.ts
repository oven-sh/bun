// A method is called and nobody reads what it answers, where some receivers have the method and others do not: how the call is written, times the loop it stands in, times what the method does, times what the
// method of the same name in another family of classes is. Each program holds one of each and is built alone.
//
//   bun write-unread-call-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<call>--<loop>--<method>--<other>.js
//   bun write-unread-call-sweep.ts count
//   bun write-unread-call-sweep.ts named <pattern> <folder> [most]
//
// Where the ways of a call part by the receiver they meet again behind it. A way that has ended brings no value to the meeting, and neither does one that is alive where nobody reads the value: a compiler that
// tells the two by the value alone drops a living way. The frame around the call is one in which that showed; every part of it was needed.
import { mkdirSync, writeFileSync } from "fs";

const calls: [string, string][] = [
  ["a-statement", "holder.bump();"],
  ["under-void", "void holder.bump();"],
  ["under-a-written-key", `holder["bump"]();`],
  ["under-a-key-in-a-variable", "holder[name]();"],
  ["twice-in-a-row", "holder.bump();\nholder.bump();"],
  ["in-front-of-a-comma", "holder.bump(), 0;"],
  ["behind-a-comma", "0, holder.bump();"],
  ["with-arguments", "holder.bump(1, holder);"],
  ["with-a-spread-list", "holder.bump(...[]);"],
  ["with-a-spread-list-from-data", "holder.bump(...list);"],
  ["by-call", "holder.bump.call(holder);"],
  ["by-call-on-another", "holder.bump.call(one);"],
  ["by-apply", "holder.bump.apply(holder, []);"],
  ["by-apply-with-a-list-from-data", "holder.bump.apply(holder, list);"],
  ["by-apply-with-its-arguments", "holder.bump.apply(holder, arguments);"],
  ["by-reflect", "Reflect.apply(holder.bump, holder, []);"],
  ["by-a-bound-function", "holder.bump.bind(holder)();"],
  ["by-new", "new holder.bump();"],
  ["off-a-holder-that-may-be-absent", "holder?.bump();"],
  ["where-the-method-may-be-absent", "holder.bump?.();"],
  ["without-its-receiver", "(0, holder.bump)();"],
  ["as-a-tag", "holder.bump``;"],
  ["negated", "!holder.bump();"],
  ["asked-for-its-kind", "typeof holder.bump();"],
  ["in-front-of-or", "holder.bump() || 0;"],
  ["in-front-of-and", "holder.bump() && 0;"],
  ["behind-and", "holder && holder.bump();"],
  ["in-front-of-a-default", "holder.bump() ?? 0;"],
  ["as-a-choice", "holder.bump() ? 0 : 1;"],
  ["in-an-arm-of-a-choice", "turns ? holder.bump() : 0;"],
  ["into-a-constant-nobody-reads", "{\n  const unread = holder.bump();\n}"],
  ["as-the-test-of-an-empty-if", "if (holder.bump()) {\n}"],
  ["as-the-subject-of-an-empty-switch", "switch (holder.bump()) {\n}"],
  ["in-a-list-nobody-reads", "[holder.bump()];"],
  ["in-a-record-nobody-reads", "({ a: holder.bump() });"],
  ["as-an-argument-of-an-empty-function", "noted(holder.bump());"],
  ["on-what-it-answers", "holder.bump().bump();"],
  ["in-a-try", "try {\n  holder.bump();\n} finally {\n}"],
  ["in-an-arrow-called-at-once", "(() => holder.bump())();"],
  ["in-an-arrow-called-at-once-as-a-statement", "(() => {\n  holder.bump();\n})();"],
];

// BODY stands in a loop that no test ends.
const loops: [string, string][] = [
  ["for-without-a-test", "for (;;) {\nBODY\n}"],
  ["while-true", "while (true) {\nBODY\n}"],
  ["do-while-true", "do {\nBODY\n} while (true);"],
  ["a-labeled-loop-that-goes-on", "again: for (;;) {\nBODY\n  continue again;\n}"],
  ["an-endless-loop-in-an-endless-loop", "for (;;) {\n  for (;;) {\nBODY\n  }\n}"],
];

const methods: [string, string][] = [
  ["does-nothing", ""],
  ["answers-a-number", "return 1;"],
  ["answers-its-receiver", "return this;"],
  ["stores-a-field", "this.n = 1;"],
  ["throws", "throw new RangeError();"],
];

const others: [string, string][] = [
  ["the-same-method", "bump() {}"],
  ["one-that-answers-a-text", `bump() {\n    return "t";\n  }`],
  ["a-static-one-beside-it", "bump() {}\n  static bump() {}"],
];

const all = calls.length * loops.length * methods.length * others.length;

const indented = (text: string, by: string) =>
  text
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [call, statement] = pick(calls);
  const [loop, shape] = pick(loops);
  const [method, body] = pick(methods);
  const [other, second] = pick(others);
  const depth = /^( *)BODY$/m.exec(shape)![1] + "  ";
  const turn = `if (++turns > 3) throw new EvalError();\nnoted(holder);\n${statement}`;
  const text = `let turns = 0;
const name = JSON.parse('"bump"'), list = JSON.parse("[]");
function noted(o) {}
class First {}
class Second {
  bump() {${body ? `\n    ${body}\n  ` : ""}}
}
function walks(holder) {
${indented(shape.replace(/^ *BODY$/m, indented(turn, depth)), "  ")}
}
const one = new First();
class Base {}
class Heir extends Base {
  ${second}
}
function hands(holder) {
  noted(holder);
}
const base = new Base();
class Third {}
function takes(holder, other) {
  noted(other);
}
try {
  walks(one);
} catch (error) {
  console.log(error.name, turns);
}
turns = 0;
try {
  walks(new Second());
} catch (error) {
  console.log(error.name, turns);
}
try {
  walks(one), walks(new Second())(one())[(hands(new Heir()), hands(base, base()))](takes(missing, new Third()));
} catch (error) {
  console.log(error.name, turns);
}
`;
  return { name: `${call}--${loop}--${method}--${other}.js`, text };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
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
