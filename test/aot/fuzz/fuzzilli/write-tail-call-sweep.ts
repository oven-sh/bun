// A call in tail position, a million deep: the form of the call, times the way in: at the top of the file, in a loop of three turns, through a value that the compiler cannot see. Each program is one file and is
// built alone. In strict code a call in tail position takes no room on the stack. Where the language gives no tail call the RangeError is caught and its name is printed, so such a form compares too; three
// programs are scripts that are not strict.
//
//   bun write-tail-call-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<form>--<way>.<mjs | cjs>
//   bun write-tail-call-sweep.ts count
//   bun write-tail-call-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";

const N = 1000000;
// The text that declares the callee, the kind of its first call, and how the callee or the receiver is named.
const forms: Record<string, [string, string, string]> = {
  "a-declared-function": ["function step(n) { return n === 0 ? 'end' : step(n - 1); }", "F", "step"],
  "behind-an-if": ["function step(n) { if (n === 0) return 'end'; return step(n - 1); }", "F", "step"],
  "behind-an-else": ["function step(n) { if (n === 0) { return 'end'; } else { return step(n - 1); } }", "F", "step"],
  "the-right-of-an-or": ["function step(n) { return n === 0 || step(n - 1); }", "F", "step"],
  "the-right-of-an-and": ["function step(n) { return n !== 0 && step(n - 1); }", "F", "step"],
  "the-right-of-a-nullish": ["function step(n) { return (n === 0 ? 'end' : null) ?? step(n - 1); }", "F", "step"],
  "behind-a-comma": ["function step(n) { return n === 0 ? 'end' : (0, step)(n - 1); }", "F", "step"],
  "the-last-of-a-comma": [
    "let seen = 0; function step(n) { return n === 0 ? 'end' + seen : (seen++, step(n - 1)); }",
    "F",
    "step",
  ],
  "a-nested-choice": [
    "function step(n) { return n === 0 ? 'end' : n & 1 ? step(n - 1) : n & 2 ? step(n - 1) : step(n - 1); }",
    "F",
    "step",
  ],
  "an-arrow": ["const step = (n) => n === 0 ? 'end' : step(n - 1);", "F", "step"],
  "an-arrow-with-a-body": ["const step = (n) => { if (n === 0) return 'end'; return step(n - 1); };", "F", "step"],
  "a-named-function-expression": [
    "const outer = function step(n) { return n === 0 ? 'end' : step(n - 1); };",
    "F",
    "outer",
  ],
  "an-arrow-made-by-a-function": [
    "function make() { const step = (n) => n === 0 ? 'end' : step(n - 1); return step; } const made = make();",
    "F",
    "made",
  ],
  "in-a-switch": [
    "function step(n) { switch (n) { case 0: return 'end'; default: return step(n - 1); } }",
    "F",
    "step",
  ],
  "in-a-labelled-block": [
    "function step(n) { block: { if (n === 0) break block; return step(n - 1); } return 'end'; }",
    "F",
    "step",
  ],
  "in-a-loop-that-returns": [
    "function step(n) { for (;;) { if (n === 0) return 'end'; return step(n - 1); } }",
    "F",
    "step",
  ],
  "in-a-catch": [
    "function step(n) { try { throw n; } catch (e) { return e === 0 ? 'end' : step(e - 1); } }",
    "F",
    "step",
  ],
  "behind-a-try-that-has-ended": [
    "function step(n) { try { if (n < 0) throw n; } catch (e) { n = 0; } return n === 0 ? 'end' : step(n - 1); }",
    "F",
    "step",
  ],
  "inside-a-try": [
    "function step(n) { try { return n === 0 ? 'end' : step(n - 1); } catch (e) { throw e; } }",
    "F",
    "step",
  ],
  "an-optional-call": ["function step(n) { return n === 0 ? 'end' : step?.(n - 1); }", "F", "step"],
  "by-call": ["function step(n) { return n === 0 ? 'end' : step.call(undefined, n - 1); }", "F", "step"],
  "by-apply": ["function step(n) { return n === 0 ? 'end' : step.apply(undefined, [n - 1]); }", "F", "step"],
  "by-reflect-apply": [
    "function step(n) { return n === 0 ? 'end' : Reflect.apply(step, undefined, [n - 1]); }",
    "F",
    "step",
  ],
  "a-bound-function": [
    "function step(n) { return n === 0 ? 'end' : bound(n - 1); } const bound = step.bind(undefined);",
    "F",
    "bound",
  ],
  "a-spread": ["function step(n) { return n === 0 ? 'end' : step(...[n - 1]); }", "F", "step"],
  "a-rest-parameter": ["function step(...all) { return all[0] === 0 ? 'end' : step(all[0] - 1); }", "F", "step"],
  "a-default": ["function step(n, by = 1) { return n === 0 ? 'end' : step(n - by); }", "F", "step"],
  "fewer-arguments-than-parameters": [
    "function step(n, a, b, c) { return n === 0 ? 'end' + a + b + c : step(n - 1); }",
    "F",
    "step",
  ],
  "more-arguments-than-parameters": [
    "function step(n) { return n === 0 ? 'end' : step(n - 1, n, n, n, n); }",
    "F",
    "step",
  ],
  "the-callee-takes-more": [
    "function few(n) { return n === 0 ? 'end' : many(n - 1, 1, 2, 3, 4, 5, 6, 7); } function many(n, a, b, c, d, e, f, g) { return n === 0 ? 'end' + (a + b + c + d + e + f + g) : few(n - 1); }",
    "F",
    "few",
  ],
  "the-arguments-object": [
    "function step(n) { return arguments[0] === 0 ? 'end' : step(arguments[0] - 1); }",
    "F",
    "step",
  ],
  "a-pattern-for-a-parameter": ["function step({ n }) { return n === 0 ? 'end' : step({ n: n - 1 }); }", "P", "step"],
  "a-sum-carried-along": ["function step(n, sum) { return n === 0 ? sum : step(n - 1, sum + n); }", "S", "step"],
  "a-fraction-carried-along": ["function step(n, sum) { return n === 0 ? sum : step(n - 1, sum + 0.5); }", "S", "step"],
  "two-functions": [
    "function even(n) { return n === 0 ? 'even' : odd(n - 1); } function odd(n) { return n === 0 ? 'odd' : even(n - 1); }",
    "F",
    "even",
  ],
  "a-ring-of-three": [
    "function one(n) { return n === 0 ? 'one' : two(n - 1); } function two(n) { return n === 0 ? 'two' : three(n - 1); } function three(n) { return n === 0 ? 'three' : one(n - 1); }",
    "F",
    "one",
  ],
  "the-callee-is-a-parameter": [
    "function step(n, self) { return n === 0 ? 'end' : self(n - 1, self); }",
    "SELF",
    "step",
  ],
  "the-callee-comes-out-of-a-list": [
    "const table = [(n) => n === 0 ? 'zero' : table[n & 1](n - 1), (n) => n === 0 ? 'one' : table[n & 1](n - 1)];",
    "F",
    "table[0]",
  ],
  "the-callee-comes-out-of-a-map": [
    "const table = new Map(); table.set('step', (n) => n === 0 ? 'end' : table.get('step')(n - 1));",
    "F",
    "table.get('step')",
  ],
  "a-tagged-template": ["function step(texts, n) { return n === 0 ? 'end' : step`${n - 1}`; }", "T", "step"],
  "a-proxy-of-a-function": [
    "function inner(n) { return n === 0 ? 'end' : step(n - 1); } const step = new Proxy(inner, {});",
    "F",
    "step",
  ],
  "a-method-on-this": ["class Box { m(n) { return n === 0 ? 'end' : this.m(n - 1); } }", "M", "new Box()"],
  "a-method-of-a-literal-on-this": ["const box = { m(n) { return n === 0 ? 'end' : this.m(n - 1); } };", "M", "box"],
  "a-method-of-a-literal-by-its-name": ["const box = { m(n) { return n === 0 ? 'end' : box.m(n - 1); } };", "M", "box"],
  "a-method-laid-on-a-prototype": [
    "function Box() {} Box.prototype.m = function (n) { return n === 0 ? 'end' : this.m(n - 1); };",
    "M",
    "new Box()",
  ],
  "a-static-method-by-the-class": ["class Box { static m(n) { return n === 0 ? 'end' : Box.m(n - 1); } }", "M", "Box"],
  "a-static-method-on-this": ["class Box { static m(n) { return n === 0 ? 'end' : this.m(n - 1); } }", "M", "Box"],
  "a-private-method": [
    "class Box { #m(n) { return n === 0 ? 'end' : this.#m(n - 1); } m(n) { return this.#m(n); } }",
    "M",
    "new Box()",
  ],
  "a-static-private-method": [
    "class Box { static #m(n) { return n === 0 ? 'end' : Box.#m(n - 1); } static m(n) { return Box.#m(n); } }",
    "M",
    "Box",
  ],
  "a-method-under-a-computed-key": [
    "const key = JSON.parse('\"m\"'); class Box { m(n) { return n === 0 ? 'end' : this[key](n - 1); } }",
    "M",
    "new Box()",
  ],
  "an-optional-member": ["class Box { m(n) { return n === 0 ? 'end' : this?.m(n - 1); } }", "M", "new Box()"],
  "an-optional-method": ["class Box { m(n) { return n === 0 ? 'end' : this.m?.(n - 1); } }", "M", "new Box()"],
  "a-getter-gives-the-method": [
    "class Box { get next() { return this.m; } m(n) { return n === 0 ? 'end' : this.next(n - 1); } }",
    "M",
    "new Box()",
  ],
  "an-arrow-in-a-field": ["class Box { m = (n) => n === 0 ? 'end' : this.m(n - 1); }", "M", "new Box()"],
  "two-classes-take-turns": [
    "class Left { m(n) { return n === 0 ? 'left' : right.m(n - 1); } } class Right { m(n) { return n === 0 ? 'right' : left.m(n - 1); } } const left = new Left(), right = new Right();",
    "M",
    "left",
  ],
  "one-site-two-classes": [
    "class Left { m(n) { return n === 0 ? 'left' : both[n & 1].m(n - 1); } } class Right { m(n) { return n === 0 ? 'right' : both[n & 1].m(n - 1); } } const both = [new Left(), new Right()];",
    "M",
    "both[0]",
  ],
  "through-super": [
    "class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { m(n) { return super.m(n); } }",
    "M",
    "new Sub()",
  ],
  "through-super-in-an-arrow": [
    "class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { m(n) { const through = () => super.m(n); return through(); } }",
    "M",
    "new Sub()",
  ],
  "through-super-three-deep": [
    "class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Mid extends Base { m(n) { return super.m(n); } } class Sub extends Mid { m(n) { return super.m(n); } }",
    "M",
    "new Sub()",
  ],
  "through-super-under-a-computed-key": [
    "const key = JSON.parse('\"m\"'); class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { m(n) { return super[key](n); } }",
    "M",
    "new Sub()",
  ],
  "through-super-of-a-static-method": [
    "class Base { static m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { static m(n) { return super.m(n); } }",
    "M",
    "Sub",
  ],
  "through-super-of-a-literal": [
    "const base = { m(n) { return n === 0 ? 'end' : this.m(n - 1); } }; const sub = { __proto__: base, m(n) { return super.m(n); } };",
    "M",
    "sub",
  ],
  "through-super-behind-a-choice": [
    "class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { m(n) { return n & 1 ? super.m(n) : super.m(n); } }",
    "M",
    "new Sub()",
  ],
  "through-super-by-call": [
    "class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { m(n) { return super.m.call(this, n); } }",
    "M",
    "new Sub()",
  ],
  "an-inherited-method": [
    "class Base { m(n) { return n === 0 ? 'end' : this.m(n - 1); } } class Sub extends Base { }",
    "M",
    "new Sub()",
  ],
  "a-method-of-a-list-below-array": [
    "class Rows extends Array { m(n) { return n === 0 ? 'end' : this.m(n - 1); } }",
    "M",
    "new Rows()",
  ],
};
const first: Record<string, (x: string) => string> = {
  F: x => `${x}(${N})`,
  P: x => `${x}({ n: ${N} })`,
  S: x => `${x}(${N}, 0)`,
  SELF: x => `${x}(${N}, ${x})`,
  T: x => `${x}\`\${${N}}\``,
  M: x => `${x}.m(${N})`,
};
const ways: Record<string, (kind: string, x: string) => string> = {
  "at-the-top": (kind, x) =>
    `let out; try { out = ${first[kind](x)}; } catch (error) { out = error.constructor.name; }\nconsole.log(String(out));`,
  "in-a-loop": (kind, x) =>
    `let out = ""; for (let turn = 0; turn < 3; turn++) { try { out += ${first[kind](x)} + " "; } catch (error) { out += error.constructor.name + " "; } }\nconsole.log(out);`,
  "through-what-is-not-seen": (kind, x) =>
    `const unseen = (value) => [value][JSON.parse("0")];\nconst hidden = unseen(${x});\nlet out; try { out = ${first[kind]("hidden")}; } catch (error) { out = error.constructor.name; }\nconsole.log(String(out));`,
};

const programs: { name: string; text: string }[] = [];
for (const [form, [declares, kind, x]] of Object.entries(forms))
  for (const [way, text] of Object.entries(ways))
    programs.push({ name: `${form}--${way}.mjs`, text: `${declares}\n${text(kind, x)}\n` });
for (const form of ["a-declared-function", "a-method-on-this", "through-super"]) {
  const [declares, kind, x] = forms[form];
  programs.push({ name: `${form}--not-strict.cjs`, text: `${declares}\n${ways["at-the-top"](kind, x)}\n` });
}
const all = programs.length;

const pad = (at: number) => String(at).padStart(3, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    if (!pattern.test(programs[at].name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${programs[at].name}`, programs[at].text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    writeFileSync(`${folder}/${pad(at)}-${programs[at].name}`, programs[at].text);
  }
  console.log(Math.min(count, all));
}
