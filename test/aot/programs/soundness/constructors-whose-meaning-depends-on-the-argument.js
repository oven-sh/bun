function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
const show = a => a.length + ":" + Object.keys(a).join() + ":" + String(a[0]) + ":" + typeof a[0];
attempt("new Array(3)", () => show(new Array(3)));
attempt("Array(3)", () => show(Array(3)));
attempt("new Array('3')", () => show(new Array("3")));
attempt("new Array(3, 4)", () => show(new Array(3, 4)));
attempt("new Array(2.5)", () => show(new Array(2.5)));
attempt("new Array(-1)", () => show(new Array(-1)));
attempt("Array.of(3)", () => show(Array.of(3)));
attempt("Array.from({ length: 2 })", () => show(Array.from({ length: 2 })));
attempt("Array.from('ab')", () => show(Array.from("ab")));
attempt("Array.from(3)", () => show(Array.from(3)));
function make(n) {
  return new Array(n);
}
for (const n of [0, 2, "2", null, undefined, true, [5], { length: 1 }]) attempt("make " + String(n), () => show(make(n)));
function sum(a) {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += a[i] === undefined ? 100 : a[i];
  return t;
}
attempt("sum of holes", () => sum(new Array(3)) + " " + sum(make(2)) + " " + sum(make("2")) + " " + sum(Array.of(3)));
class Heir extends Array {}
attempt("new Heir(3)", () => show(new Heir(3)));
attempt("Heir.of(3)", () => show(Heir.of(3)));
attempt("new Heir(3).map", () => show(new Heir(3).map(x => 1)));
attempt("new Heir(1, 2).map", () => show(new Heir(1, 2).map(x => x * 2)) + " " + (new Heir(1, 2).map(x => x) instanceof Heir));
attempt("new Heir(1, 2).filter to one number", () => show(new Heir(1, 5).filter(x => x > 1)));
attempt("splice of an heir", () => show(new Heir(1, 2, 3).splice(0, 1)));
attempt("typed array of a number", () => show(new Uint8Array(3)) + " " + show(new Uint8Array([3])) + " " + show(new Uint8Array("2")) + " " + show(Uint8Array.of(300)) + " " + show(new Int8Array([1.9, -1.9, 200])));
attempt("string wrapper", () => show(new String("ab")) + " " + show(Object("xy")));
attempt("new Set of a string", () => [...new Set("aab")].join() + " " + new Set([NaN, NaN, 0, -0]).size + " " + new Map([[NaN, 1], [NaN, 2]]).get(NaN));
