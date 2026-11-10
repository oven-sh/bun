// `step` writes the one record of this file that has `done` and `value`, and it is handed out, so in the loop of `go` it is expected of what next() gives. What a list's, a set's, a map's, a view's and a text's own
// iterators give is no such record, nor is an object that gets the two names by a key at the run or by getters: the guess fails at every turn, or at every other one, and the turn goes on as it is written.
// STATISTIC: FailingSidesOfGuessesAtRecordsThatKeepSites = 2
// STATISTIC: BlocksWalkedApartBehindFailingSidesThatKeepSites = 1
function step(n: number) { return { done: n > 3, value: n }; }
const D: string = JSON.parse('"done"'), V: string = JSON.parse('"value"');
function odd(done: unknown, value: unknown): any { const o: any = {}; o[V] = value; o[D] = done; return o; }
function go(c: any): unknown { const it = c.values(); let s: any = 0, r = it.next(); while (!r.done) { s += r.value; r = it.next(); } return s; }
const own = (first: number) => ({ values() { let n = first; return { next() { return step(n++); } }; } });
const late = { values() { let n = 0; return { next() { return odd(n > 2, n++); } }; } };
const mixed = { values() { let n = 0; return { next() { return n & 1 ? step(n++) : odd(false, n++ * 100); } }; } };
const getters = { values() { let n = 0; return { next() { const o = {}; Object.defineProperty(o, D, { get() { return n > 2; } }); Object.defineProperty(o, V, { get() { return n++ * 10; } }); return o; } }; } };
const thrower = { values() { let n = 0; return { next() { if (n++ > 1) throw new RangeError("no third"); return odd(false, n); } }; } };
const frozen = { values() { let n = 0; return { next() { return Object.freeze(step(n += 2)); } }; } };
const given: any[] = JSON.parse('[[1,2,3],[],["a","b"]]');
given.push(new Set([4, 5, 6]), new Map([[1, 7], [2, 8]]), own(1), own(9), late, mixed, getters, frozen, new Uint8Array([9, 10]), { values: () => "xyz"[Symbol.iterator]() });
for (let turn = 0; turn < 3; turn++) {
  const said: string[] = [];
  for (const c of given) said.push(String(go(c)));
  try { go(thrower); said.push("no throw"); } catch (e) { said.push((e as Error).name + ": " + (e as Error).message); }
  console.log(said.join(" | "));
}
