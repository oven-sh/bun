// A loop whose test over an unchanging read has both sides leave the loop: one returns, the other is the unlikely way. The compiler stopped on the first form.
const stop = () => "stop";
function collect(bytes, source, wanted, at, done) {
  at = at === undefined ? 0 : at;
  done = done === undefined ? [] : done;
  if (done.length === wanted) return { done, at };
  if (source.take === stop) return { done, at };
  const got = source.take(bytes, at);
  if (got === "stop") return { done, at };
  return collect(bytes, source, wanted, got.at, [...done, got.item]);
}
const source = JSON.parse('{"kind":"source"}');
source.take = (bytes, at) => (at < bytes.length ? { item: bytes[at], at: at + 1 } : "stop");
const bytes = Buffer.from("abcdef");
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += collect(bytes, source, turn & 7).done.length;
console.log(sum, JSON.stringify(collect(bytes, source, 3)), JSON.stringify(collect(bytes, { take: stop }, 3)));

// The same shape by other tests that hand something on: a comparison, a truth test, `typeof`, a bound.
function byComparison(holder, list) {
  let found = 0;
  for (let index = 0; ; index++) {
    const mode = holder.mode;
    if (mode === "never") return -1;
    if (mode !== "count") return mode.length + found;
    if (index >= list.length) return found;
    found += list[index];
  }
}
function byTruth(holder, list) {
  let found = 0;
  for (let index = 0; ; index++) {
    const step = holder.step;
    if (!step) return found;
    if (typeof step !== "number") return step.length;
    if (index >= list.length) return found;
    found += list[index] * step;
  }
}
function byBound(holder, list) {
  let found = 0;
  for (let index = 0; ; index++) {
    const limit = holder.limit;
    if (limit < 0) return -limit;
    if (limit > 100) return limit;
    if (index >= limit || index >= list.length) return found;
    found += list[index];
  }
}
const parsed = text => JSON.parse(text);
const numbers = [1, 2, 3, 4];
const lines = [];
for (let turn = 0; turn < 200; turn++) {
  const results = [
    byComparison(parsed('{"mode":"count"}'), numbers),
    byComparison(parsed(turn === 150 ? '{"mode":"other"}' : '{"mode":"count"}'), numbers),
    byTruth(parsed('{"step":2}'), numbers),
    byTruth(parsed(turn === 150 ? '{"step":"text"}' : turn === 151 ? '{"step":0}' : '{"step":1}'), numbers),
    byBound(parsed('{"limit":3}'), numbers),
    byBound(parsed(turn === 150 ? '{"limit":-5}' : turn === 151 ? '{"limit":500}' : '{"limit":2}'), numbers),
  ].join();
  if (!lines.includes(results)) lines.push(results);
}
console.log(lines.join("\n"));
