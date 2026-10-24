function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
const sealed = Object.seal([1, 2]);
const closed = Object.preventExtensions([1, 2]);
const frozen = Object.freeze([1, 2]);
for (const [name, list] of [["sealed", sealed], ["closed", closed], ["frozen", frozen]]) {
  attempt(name + " push", () => list.push(3));
  attempt(name + " store past the end", () => ((list[2] = 3), list.length));
  attempt(name + " store inside", () => ((list[0] = 9), list[0]));
  attempt(name + " pop", () => list.pop());
  attempt(name + " length", () => ((list.length = 0), list.length));
  attempt(name + " delete", () => delete list[0]);
  attempt(name + " name", () => ((list.extra = 1), list.extra));
  attempt(name + " after", () => list.join() + " " + list.length + " " + Object.keys(list).join());
}
attempt("sealed alone, push", () => sealed.push(4));
attempt("sealed alone, store", () => ((sealed[5] = 4), sealed.length));
attempt("frozen alone, store", () => ((frozen[0] = 4), frozen[0]));
attempt("frozen alone, fill", () => frozen.fill(0).join());
attempt("frozen alone, sort", () => frozen.sort().join());
attempt("closed alone, unshift", () => closed.unshift(0));
function grow(list) {
  for (let i = 0; i < 4; i++) list[i] = i;
  return list.length;
}
attempt("grow sealed", () => grow(Object.seal([7])));
attempt("grow frozen", () => grow(Object.freeze([7])));
attempt("grow closed", () => grow(Object.preventExtensions([7])));
