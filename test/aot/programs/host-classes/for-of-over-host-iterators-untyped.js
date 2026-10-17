// `for..of` where the iterator's `next`, or the iterable's `[Symbol.iterator]`, is a function of the host or of the engine and not compiled code.
const lines = [];
function say(label, work) {
  let text;
  try {
    text = JSON.stringify(work());
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(label + ": " + text);
}
function collect(iterable) {
  const seen = [];
  for (const item of iterable) seen.push(item);
  return seen;
}
function collectPairs(iterable) {
  const seen = [];
  for (const [key, value] of iterable) seen.push(key + "=" + value);
  return seen;
}
function firstOf(iterable) {
  for (const item of iterable) return item;
  return "none";
}

const query = () => new URLSearchParams("a=1&b=two&a=3&c=%20x");
for (let turn = 0; turn < 3; turn++) {
  say("search parameters " + turn, () => collect(query()));
  say("entries " + turn, () => collectPairs(query().entries()));
  say("keys " + turn, () => collect(query().keys()));
  say("values " + turn, () => collect(query().values()));
  say("no entries " + turn, () => [collect(new URLSearchParams("")), collectPairs(new URLSearchParams().entries())]);
  say("headers " + turn, () => collectPairs(new Headers({ "X-B": "2", "x-a": "1", accept: "*/*" })));
  say("the keys of headers " + turn, () => collect(new Headers([["b", "1"], ["a", "2"]]).keys()));
  say("a form " + turn, () => { const form = new FormData(); form.append("name", "value"); form.append("other", String(turn)); return collectPairs(form); });
  say("left early " + turn, () => [firstOf(query()), firstOf(query().keys()), firstOf(new URLSearchParams())]);
}
say("one iterator in two loops", () => { const entries = query().entries(); return [firstOf(entries), collect(entries), collect(entries)]; });
say("appended to while it is walked", () => { const q = new URLSearchParams("a=1"); const seen = []; for (const [key] of q) { seen.push(key); if (seen.length < 4) q.append(key + "x", "1"); } return seen; });
say("deleted from while it is walked", () => { const q = query(); const seen = []; for (const [key] of q) { seen.push(key); q.delete("b"); } return seen; });
say("loops inside loops", () => { const seen = []; for (const [a] of query()) for (const b of new URLSearchParams("x=1&y=2").keys()) seen.push(a + b); return seen; });
say("a throw in the body", () => { const entries = query().entries(); try { for (const pair of entries) throw new Error(pair[0]); } catch (error) { return [error.message, collect(entries).length]; } });

const next = Object.getPrototypeOf(query().entries()).next;
say("the host's next on another receiver", () => collect({ [Symbol.iterator]() { return { next }; } }));
say("the host's next, bound", () => { const entries = query().entries(); return collect({ [Symbol.iterator]() { return { next: next.bind(entries) }; } }); });
say("the host's next on an object that inherits from the iterator", () => collect({ [Symbol.iterator]() { return Object.create(query().entries()); } }));
say("a next that answers a number", () => collect({ [Symbol.iterator]() { return { next: Math.abs }; } }));
say("a next that answers a string", () => collect({ [Symbol.iterator]() { return { next: String }; } }));
say("a next that is a class", () => collect({ [Symbol.iterator]() { return { next: Map }; } }));
say("a next that is no function", () => collect({ [Symbol.iterator]() { return { next: {} }; } }));
say("a next that answers objects of its own shape", () => { let left = 3; const results = () => Object.assign(Object.create(null), { extra: 0, value: left, done: left-- === 0 }); return collect({ [Symbol.iterator]() { return { next: results.bind(null) }; } }); });
say("return is called when the loop is left", () => { const calls = []; const entries = query().entries(); const iterator = { next: next.bind(entries), return() { calls.push("return"); return {}; } }; return [firstOf({ [Symbol.iterator]: () => iterator }), calls]; });

say("the method is the host's", () => { const q = query(); return collectPairs({ [Symbol.iterator]: q.entries.bind(q) }); });
say("the method is the host's, on another receiver", () => collect({ [Symbol.iterator]: URLSearchParams.prototype.entries }));
say("the method is the engine's", () => collect({ length: 2, 0: "x", 1: "y", [Symbol.iterator]: Array.prototype.values }));
say("the method answers a number", () => collect({ [Symbol.iterator]: Math.abs }));
say("the method is a class", () => collect({ [Symbol.iterator]: Set }));
say("segments", () => collect(new Intl.Segmenter("en", { granularity: "word" }).segment("to be")).map(part => part.segment));
say("matches", () => collect("a1b22".matchAll(/\d+/g)).map(match => match[0]));

console.log(lines.join("\n"));
