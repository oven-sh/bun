// The step of an async generator or object keys is stored on the generator and called there.
const show = value =>
  (typeof value === "object" && value !== null) || typeof value === "function"
    ? Object.prototype.toString.call(value)
    : typeof value + " " + String(value);
function reach(it, f) {
  it.f = f;
  return it.f({ a: 1 }).length;
}
for (const second of [process.argv.length > 99, process.argv.length < 99]) {
  const it = (async function* () {
    yield 1;
  })();
  try {
    console.log(show(reach(it, second ? Object.keys : it.next)));
  } catch (error) {
    console.log("THROWS", error?.name);
  }
}
