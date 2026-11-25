class Row {
  constructor(n) {
    this.n = n;
  }
  [Symbol.iterator]() {
    let i = 0;
    const n = this.n;
    return {
      next() {
        return i < n ? { done: false, value: i++ } : { done: true, value: undefined };
      },
      return() {
        i = n;
        return { done: true, value: undefined };
      },
    };
  }
}
function once(it) {
  const step = it.next;
  const stop = it.return;
  const r = step.call(it);
  stop.call(it);
  return r.value;
}
let sum = 0;
for (const v of new Row(4)) sum += v;
const strange = new Function(
  "let i = 0; return { next() { return i < 6 ? { done: false, value: i++ } : { done: true, value: undefined }; }, return() { return {}; } };",
);
console.log(sum, once(strange()), once(strange()));
