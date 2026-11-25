// A position that a loop steps many times a turn, from every kind of beginning.
function ten(view, from, turns) {
  let at = from;
  for (let turn = 0; turn < turns; turn++) {
    view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn;
  }
  return at;
}
function mixed(view, from, turns) {
  let at = from, sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[++at] = turn; view[++at] = turn; view[++at] = turn; view[++at] = turn;
    if (turn === 2) at += 2;
    sum += view[at - 1] | 0;
  }
  return [at, sum].join();
}
function down(view, from, turns) {
  let at = from;
  for (let turn = 0; turn < turns; turn++) {
    view[--at] = turn; view[--at] = turn; view[--at] = turn; view[--at] = turn; view[--at] = turn; view[--at] = turn; view[--at] = turn; view[--at] = turn; view[--at] = turn;
  }
  return at;
}
function forty(view, from, turns) {
  let at = from;
  for (let turn = 0; turn < turns; turn++) {
    view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn; view[at++] = turn;
  }
  return at;
}
globalThis.unseen = [ten, mixed, down, forty];
const call = (0, eval)("(function (f, ...rest) { return f(...rest); })");
const show = value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value));
const views = [() => new Int32Array(48), () => new Uint8Array(48), () => new Float64Array(48), () => new Uint8ClampedArray(7), () => [1, 2, 3], () => ({}), () => "text", () => new Proxy([], {}), () => Object.freeze([1, 2])];
const starts = [0, 1, -0, -3, 0.5, 2147483640, 4294967290, 2 ** 53 - 4, NaN, Infinity, "5", "x", undefined, null, true, { valueOf: () => 4 }, 3n];
for (const f of [ten, mixed, down, forty])
  for (const [number, make] of views.entries())
    for (const start of starts) {
      if (typeof start === "number" && start > 100 && number > 3) continue;
      const view = make();
      let said;
      try {
        said = show(call(f, view, start, 4));
      } catch (error) {
        said = error.constructor.name;
      }
      let left = "";
      try {
        left = Array.prototype.slice.call(view, 0, 48).map(show).join() + Object.keys(view).length;
      } catch (error) {
        left = error.constructor.name;
      }
      console.log(f.name, number, typeof start === "object" && start ? "object" : show(start), said, left);
    }
