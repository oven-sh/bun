// Generator throw is caught inside: compiled answers as plain.
function* g() {
  let n = 0;
  while (true) {
    try {
      yield n++;
    } catch (e) {
      n = e;
    }
  }
}
const it = g();
console.log(it.next().value, it.next().value, it.throw(10).value, it.next().value);
