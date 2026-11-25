// Arrays and views in fields, in an object of a constant that may be in its dead zone, and in captured variables that inner loops read; bounds in fields.
const show = (value) => Array.isArray(value) || ArrayBuffer.isView(value) ? value.buffer?.detached ? "detached" : "[" + Array.from(value, (element) => Object.is(element, -0) ? "-0" : String(element)).join() + "]" : String(value);
const attempt = (run) => { try { return show(run()); } catch (error) { return error.constructor.name; } };
const fill = (length, element) => { const made = []; for (let i = 0; i < length; i++) made.push(element(i)); return made; };

function copyState() { for (let i = 0; i < state.count; i++) state.list[i] = state.other[i]; return state.list; }
function countState() { for (let i = 0; i < state.count; i++) state.list[state.other[i] & 3]++; return state.list; }
function sumState() { let total = 0; for (let i = 0; i < state.count; i++) total += state.list[i]; return total; }
function shiftState() { for (let i = 1; i < state.count; i++) state.list[i - 1] = state.list[i]; return state.list; }
function replaceState() { let total = 0; for (let i = 0; i < state.count; i++) { total += state.list[i]; if (i === 2) state.list = state.other; } return total; }
function shortenState() { let total = 0; for (let i = 0; i < state.count; i++) { total += state.list[i]; if (i === 2) state.count = 4; } return total; }
function catchState() { let total = 0; try { for (let i = 0; i < state.count; i++) total += state.list[i]; } catch (error) { total = error.constructor.name; } return total; }
function effectFirst(log) { for (let i = 0; i < (log.push(i), state.count); i++) state.list[i] = i; return state.list; }
// Arrays alone are in this object, so the check for its dead zone may be made before a loop that begins with it, and only there.
let begun = 0;
const begin = () => { begun++; };
function copyFixed() { for (let i = 0; i < fixed.count; i++) fixed.list[i] = fixed.other[i]; return fixed.list; }
function beginFixed() { for (let i = 0; i < (begin(), fixed.count); i++) fixed.list[i] = fixed.other[i]; return fixed.list; }
function catchFixed() { let result = "none"; try { for (let i = 0; i < fixed.count; i++) fixed.list[i] = fixed.other[i]; } catch (error) { result = error.constructor.name; } return result; }
function skipFixed(n) { let i = 0; for (; i < n; i++) fixed.list[i] = fixed.other[i]; return i; }
for (const step of [copyFixed, beginFixed, catchFixed, () => skipFixed(0), () => skipFixed(1)]) console.log("fixed", attempt(step), begun);
const fixed = { list: [1, 2, 3, 4], other: [5, 6, 7, 8], count: 3 };
for (const step of [copyFixed, beginFixed, catchFixed, () => skipFixed(0), () => skipFixed(1)]) console.log("fixed", attempt(step), begun);
const ofState = { copyState, countState, sumState, shiftState, replaceState, shortenState, catchState };
for (const name in ofState) console.log(name, "before the declaration", attempt(ofState[name]));
{ const log = []; console.log("effects first", attempt(() => effectFirst(log)), show(log)); }
const state = { list: fill(6, (i) => i), other: fill(6, (i) => 10 + i), count: 6 };
function assignState(list, other, count) { state.list = list; state.other = other; state.count = count; }

class Machine {
  constructor(list, other, count) { this.list = list; this.other = other; this.count = count; }
  copy() { for (let i = 0; i < this.count; i++) this.list[i] = this.other[i]; return this.list; }
  sum() { let total = 0; for (let i = 0; i < this.count; i++) total += this.list[i]; return total; }
  add() { for (let i = 0; i < this.count; i++) this.list[i] += this.other[i]; return this.list; }
  half() { for (let i = 0; i <= this.count; i++) this.list[i] = this.list[i] * 0.5 + 1; return this.list; }
  stack() { let top = 0; for (let i = 0; i < this.count; i++) this.list[top++] = i * 2; let total = 0; while (top > 0) total += this.list[--top]; return total; }
  replace() { let total = 0; for (let i = 0; i < this.count; i++) { total += this.list[i]; if (i === 1) this.list = this.other; } return total; }
  grow() { let total = 0; for (let i = 0; i < this.count; i++) { total += this.list[i]; if (i === 1) this.count = 5; } return total; }
  release() { let total = 0; for (let i = 0; i < this.count; i++) { total += this.list[i]; if (i === 1 && ArrayBuffer.isView(this.list)) structuredClone(this.list.buffer, { transfer: [this.list.buffer] }); } return total; }
}
const methods = ["copy", "sum", "add", "half", "stack", "replace", "grow", "release"];

function makePairs() {
  var first; var second; var length;
  function assign(a, b, n) { first = a; second = b; length = n; }
  function pairs() { let total = 0; for (let i = 0; i < length; i++) for (let j = 0; j < i; j++) total += first[i] * second[j]; return total; }
  function equal() { let count = 0; for (let i = 0; i < length; i++) for (let j = i + 1; j < length; j++) if (first[i] === first[j]) count++; return count; }
  function swap() { let total = 0; for (let i = 0; i < length; i++) { for (let j = 0; j < i; j++) total += first[i] - second[j]; if (i === 2) { const kept = first; first = second; second = kept; } } return total; }
  function forget() { let total = 0; for (let i = 0; i < length; i++) { for (let j = 0; j < i; j++) total += first[j]; if (i === 3) first = undefined; } return total; }
  return { assign, pairs, equal, swap, forget };
}
const inner = makePairs();

const makers = [
  ["integers", () => fill(6, (i) => (i * 5) % 4)], ["fractions", () => fill(6, (i) => i + 0.5)], ["holes", () => { const made = [1, , 3, , 5, 6]; return made; }], ["strings", () => fill(6, (i) => "s" + i)], ["large", () => fill(6, (i) => 2147483640 + i * 3)],
  ["doubles", () => Float64Array.from([0, 1.5, -0, 3, 4, 5])], ["words", () => Int32Array.from([0, 1, 2147483647, -2147483648, 4, 5])], ["bytes", () => Uint8Array.from([0, 250, 251, 252, 4, 5])], ["clamped", () => Uint8ClampedArray.from([0, 250, 251, 252, 4, 5])],
  ["short", () => [1, 2]], ["short words", () => new Int32Array(3)], ["undefined", () => undefined],
];
const counts = [6, 3, 0, -2, 9, 2.5, undefined, "4", NaN, 4294967296];
for (const [kind, make] of makers) {
  for (const count of kind === "integers" || kind === "words" ? counts : [6, 9]) {
    if (count === 4294967296 && kind === "integers") continue;
    let line = kind + " " + count;
    for (const name in ofState) if (count !== 4294967296) { assignState(make(), fill(6, (i) => 10 + i), count); line += " | " + name + " " + attempt(ofState[name]); }
    for (const name of methods) if (count !== 4294967296) { const machine = new Machine(make(), make(), count); line += " | " + name + " " + attempt(() => machine[name]()) + " " + show(machine.list); }
    for (const name of ["pairs", "equal", "swap", "forget"]) if (count !== 4294967296) { inner.assign(make(), fill(6, (i) => i), count === 9 ? 6 : count); line += " | " + name + " " + attempt(inner[name]); }
    console.log(line);
  }
}
