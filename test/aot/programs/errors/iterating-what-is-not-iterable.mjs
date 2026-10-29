// Every way to iterate, over values that are not iterable or whose iterator is broken: the class and the wording of each error.
const withoutSourceText = message => message.replace(/ \((evaluating|near) '.*'\)$/s, "");
const opaque = value => [value, 0][Number(process.argv.length > 100)];
const iterables = {
  "no method": {},
  "method is 5": { [Symbol.iterator]: 5 },
  "method is null": { [Symbol.iterator]: null },
  "method is an object": { [Symbol.iterator]: {} },
  "returns 5": { [Symbol.iterator]() { return 5; } },
  "returns undefined": { [Symbol.iterator]() {} },
  "returns null": { [Symbol.iterator]() { return null; } },
  "returns a string": { [Symbol.iterator]() { return "text"; } },
  "returns {}": { [Symbol.iterator]() { return {}; } },
  "next is 5": { [Symbol.iterator]() { return { next: 5 }; } },
  "next returns 5": { [Symbol.iterator]() { return { next() { return 5; } }; } },
  "next returns undefined": { [Symbol.iterator]() { return { next() {} }; } },
  "a number": 5,
  "true": true,
  "a symbol": Symbol("s"),
  "null": null,
  "undefined": undefined,
  "a function": function named() {},
  "async method is 5": { [Symbol.asyncIterator]: 5 },
  "async returns 5": { [Symbol.asyncIterator]() { return 5; } },
  "async returns {}": { [Symbol.asyncIterator]() { return {}; } },
  "async next returns 5": { [Symbol.asyncIterator]() { return { next() { return 5; } }; } },
};
const holder = { take(...all) { return all.length; } };
class Taker { constructor(...all) { this.all = all; } }
const forms = {
  "for of": v => { for (const x of v) break; },
  "for of, to the end": v => { for (const x of v) ; },
  "[a] =": v => { const [a] = v; },
  "[...a] =": v => { const [...a] = v; },
  "[] =": v => { const [] = v; },
  "([a]) =>": v => (([a]) => a)(v),
  "[...v]": v => [...v],
  "[1, ...v, 2]": v => [1, ...v, 2],
  "f(...v)": v => Math.max(...v),
  "f(1, ...v)": v => Math.max(1, ...v),
  "o.f(...v)": v => holder.take(...v),
  "new C(...v)": v => new Taker(...v),
  "yield*": v => { for (const x of (function* () { yield* v; })()) break; },
  "yield* in async": async v => { for await (const x of (async function* () { yield* v; })()) break; },
  "for await": async v => { for await (const x of v) break; },
  "Array.from": v => Array.from(v),
  "new Set": v => new Set(v),
  "new Map": v => new Map(v),
  "Promise.all": async v => await Promise.all(v),
  "Object.fromEntries": v => Object.fromEntries(v),
};
for (const [form, run] of Object.entries(forms)) {
  for (const [name, value] of Object.entries(iterables)) {
    try { await run(opaque(value)); console.log(form, "|", name, "| nothing thrown"); } catch (error) { console.log(form, "|", name, "|", withoutSourceText(String(error))); }
  }
}
