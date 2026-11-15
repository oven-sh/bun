// `map` over a long list bears a list of holes and fills it. Whatever the callback gives, in whatever order, and wherever the source has a hole, the list that is made reads as it does in plain Bun.
"use strict";
const name = JSON.parse('"go"'), length = 300;
const parsed = (element) => JSON.parse("[" + Array.from({ length }, (_, i) => element(i)).join() + "]");
const whole = parsed((i) => i), fractions = parsed((i) => i + 0.5), holed = parsed((i) => i + 0.5); delete holed[7]; delete holed[299];
const shown = (list) => { let text = list.length + ":"; for (let i = 0; i < list.length; i += 23) text += (i in list ? typeof list[i] + " " + (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole") + ","; return text + (7 in list) + (299 in list); };
const makers = [
  { go(s) { return s.map((x) => x); } }, { go(s) { return s.map((x) => x / 2); } }, { go(s) { return s.map((x, i) => (i < 150 ? x : "t" + x)); } },
  { go(s) { return s.map((x, i) => (i === 0 ? { x } : x)); } }, { go(s) { return s.map((x, i) => (i % 3 ? x : undefined)); } }, { go(s) { return s.map((x, i) => (i === 46 ? NaN : i === 69 ? -0 : x)); } },
  { go(s) { return s.map((x, i) => (i === 92 ? 2 ** 31 : i === 115 ? -(2 ** 31) - 1 : x | 0)); } }, { go(s) { return s.map((x, i, all) => { if (i === 10) all.length = 200; return x; }); } },
];
const said = new Set();
for (let turn = 0; turn < 40; turn++) for (const maker of makers) for (const source of [whole, fractions, holed]) said.add(shown(maker[name](source.slice())));
console.log([...said].join("\n"));
