async function real(x: unknown) { await null; return "real " + x; }
let current: (x: unknown) => unknown = real;
function install(next: (x: unknown) => unknown) { current = next; }
function missed(x: unknown) { return "missed " + x; }
function ask(x: unknown) { return current(x); }
async function byChoice(hit: boolean, x: unknown) {
  const got = await (hit ? current(x) : missed(x));
  return typeof got + " " + String(got);
}
async function byCopy(x: unknown) {
  const got = await ask(x);
  return typeof got + " " + String(got);
}
install(real);
let last = "";
for (let i = 0; i < 400; i++) last = (await byChoice(i % 2 === 0, i)) + " | " + (await byCopy(i));
console.log(last);
install((0, eval)("(x) => Promise.resolve('stranger ' + x)"));
console.log(await byChoice(true, 1));
console.log(await byCopy(2));
