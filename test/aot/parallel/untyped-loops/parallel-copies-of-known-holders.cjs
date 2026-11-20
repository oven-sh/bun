// Copies under one key of holders of which something is known: they are left to the loop. One function a set of holders.
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
const heir = (...list) => new (class extends Array { })(...list);
const view = (...list) => new Float64Array(list);
const show = all => all.map(x => Object.prototype.toString.call(x) + x.length + ":" + Array.from(x, y => Object.is(y, -0) ? "-0" : String(y))).join("|");
function copies1(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = a[i]; b[i] = c[i]; } return [a, b, c]; }
function copies2(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = a[i]; b[i] = c[i]; } return [a, b, c]; }
function copies3(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = a[i]; b[i] = c[i]; } return [a, b, c]; }
function copies4(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = a[i]; b[i] = c[i]; } return [a, b, c]; }
function copies5(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = a[i]; b[i] = a[i]; } return [a, b, c]; }
function copies6(a, b, c, n) { for (let i = 0; i < n; i++) { b[i] = a[i]; c[i] = a[i]; } return [a, b, c]; }
function copies7(a, b, c, n) { for (let i = 0; i < n; i++) { b[i] = c[i]; a[i] = c[i]; } return [a, b, c]; }
function copies8(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = b[i]; a[i] = b[i]; } return [a, b, c]; }
for (let turn = 0; turn < 5; turn++) {
  const n = 2 + turn;
  console.log(attempt(() => show(copies1(view(-2.5, 3.75, 1.25, 0.1, -0, 1.25), [222, 151, 138, 194, 16, 242], heir(95, 10, 140, 40), n))));
  console.log(attempt(() => show(copies2([1, 2, , 4, 5, 6], view(7, 8, 9, 1, 2, 3), heir("a", "b", "c", "d"), n))));
  console.log(attempt(() => show(copies3(heir("x", "y", "z"), [1, 2, 3, 4], view(1, 2, 3, 4, 5, 6), n))));
  console.log(attempt(() => show(copies4(view(1, 2, 3, 4, 5, 6), heir("x", "y", "z"), ["p", "q"], n))));
  console.log(attempt(() => show(copies5(heir({}, 1, "z"), view(1, 2, 3, 4, 5, 6), ["p", "q"], n))));
  console.log(attempt(() => show(copies6(["a", "b", "c"], heir(1, 2, 3, 4), view(1, 2, 3), n))));
  console.log(attempt(() => show(copies7(heir(1, 2, 3, 4), view(1, 2, 3), ["a", , "c"], n))));
  console.log(attempt(() => show(copies8(view(1, 2, 3), ["a", , "c"], heir(1, 2, 3, 4), n))));
}
// What the first program of this stop asked: functions that are not there.
function copies(a, b, c, n) { for (let i = 0; i < n; i++) { c[i] = a[i]; b[i] = c[i]; } return [a, b, c]; }
console.log(attempt(() => missing(copies(view(1, 2), [3, 4], heir(5, 6), 2))));
