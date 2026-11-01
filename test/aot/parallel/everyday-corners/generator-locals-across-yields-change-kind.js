// Generator locals across yields change kind: compiled answers as plain.
function* g() {
  let v = 1;
  v = yield v;
  v = yield typeof v + v;
  yield [v, typeof v].join();
}
const it = g();
console.log(it.next().value, it.next("s").value, it.next({}).value);
