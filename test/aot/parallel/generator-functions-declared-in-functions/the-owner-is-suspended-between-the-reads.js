// the shared place of an owner whose frame is saved. plain: true true
const n = +process.argv[2] || 3;
const above = made => Object.getPrototypeOf(made);
async function f() {
  function* gen() { yield n; }
  const a = () => gen();
  const first = a();
  await null;
  const b = () => gen();
  return above(first) === above(b());
}
function* g() {
  function* gen() { yield n; }
  const a = () => gen();
  const first = a();
  yield 1;
  const b = () => gen();
  yield above(first) === above(b());
}
f().then(answer => console.log(String(answer) + " " + String([...g()][1])));
