// Sums handed to functions that are called without a receiver: free names, names taken out of objects, push taken off its list.
let taken = 0, total = 0;
globalThis.take = () => (taken += 1.5);
globalThis.note = sum => { total += sum; };
globalThis.turns = 5;
const free = () => { for (let k = 0; k < turns; k++) { let first = take(); note(take() - first); } };
const apart = ({ fn: step, toMs: scale }, pairs) => {
  for (let k = 0; k < pairs; k++) { let first = step(); scale(step() - first); }
  const list = [];
  for (let k = 0; k < pairs; k++) { let first = step(), spent = scale(step() - first); spent > 0 && list.push(spent); }
  return list.length * 2 < pairs ? 0 : list.sort((a, b) => a - b)[list.length >> 1];
};
const byOptional = (p, list) => { for (let k = 0; k < list.length; k++) { const { note } = p; note?.(list[k] + 1); (0, p.note)(list[k] - 1); } };
const pushed = (list, others) => { const { push } = list; const lengths = []; for (let k = 0; k < others.length; k++) { try { lengths.push(push(others[k] + 1)); } catch (e) { lengths.push(e.constructor.name); } } return lengths.join(); };
const show = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
free(); console.log(taken, total);
let clock = 0;
for (const p of [{ fn: () => (clock += 3), toMs: x => x / 2 }, { fn: () => (clock += 0.25), toMs: x => x * 1e3 }, { fn: () => ++clock, toMs: x => x }, { fn: () => "4", toMs: x => x + 1 }, { fn: () => 7n, toMs: x => Number(x) }, { fn: () => ++clock }]) {
  console.log(show(() => apart(p, 20)), show(() => apart(p, 0)), clock);
}
const seen = [];
console.log(show(() => byOptional({ note: x => seen.push(x) }, [1, 2.5, "3", null, undefined, 2147483647, -0])), seen.join());
console.log(show(() => byOptional({}, [1])), show(() => byOptional({ note: null }, [1])));
console.log(pushed([1, 2], [1, 2.5, "x", undefined]), pushed([], []));
globalThis.take = () => 2; globalThis.note = sum => { total = sum; }; free(); console.log(taken, total);
delete globalThis.note; console.log(show(free));
