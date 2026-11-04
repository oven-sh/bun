// `return await (..)` under a handler
// First what the compiler expects, then eight strangers out of unseen code in its place. A second async function ticks beside each call, so that a turn more or less shows.
const log: string[] = []; (globalThis as any).seen = log;
// A promise that is rejected and that the form never comes to await ends no program here.
process.on("unhandledRejection", () => {});
async function real(x: unknown) { log.push("real " + x); await null; return "real " + x; }
class Keeper { base = 1; async fetchOne(key: unknown) { log.push("fetch " + key); await null; return "kept " + key + this.base; } }
function missed(x: unknown) { return "missed " + x; }
let current: (x: unknown) => unknown = real;
function install(next: (x: unknown) => unknown) { current = next; }
function ask(x: unknown) { return current(x); }
const hooks: { current: (x: unknown) => unknown } = { current: real };
const show = (got: unknown) => typeof got + " " + String(got);
async function ticks() { for (let i = 0; i < 7; i++) { log.push("t" + i); await null; } }
async function inner(hit: boolean, x: unknown) { try { return await (hit ? current(x) : missed(x)); } catch (error) { return "caught inside " + String(error); } }
async function form(hit: boolean, x: unknown, keeper: Keeper): Promise<string> {
  return show(await inner(hit, x));
}
install(real);
let last = "";
for (let i = 0; i < 300; i++) last = await form(i % 2 === 0, i, new Keeper());
console.log(last);
const strangers: [string, string][] = [
  ["a promise", "(x) => Promise.resolve('stranger ' + x)"],
  ["a thenable whose then is a getter", "(x) => ({ get then() { seen.push('get then'); return (ok) => { seen.push('then called'); ok('thenable ' + x); }; } })"],
  ["no promise", "(x) => 'plain ' + x"],
  ["a rejected promise", "(x) => Promise.reject(new Error('rejected ' + x))"],
  ["it throws", "(x) => { throw new Error('thrown ' + x); }"],
  ["a slow async function", "async (x) => { seen.push('slow begins'); await null; await null; return 'slow ' + x; }"],
  ["a class below Promise with a then of its own", "(x) => { class Own extends Promise { then(a, b) { seen.push('own then'); return super.then(a, b); } } return Own.resolve('below ' + x); }"],
  ["an object whose then is no function", "(x) => ({ then: 5, toString() { return 'then is 5, ' + x; } })"],
];
for (const [name, text] of strangers) {
  const stranger = (0, eval)(text); install(stranger); hooks.current = stranger;
  const keeper = (0, eval)("(fetchOne) => ({ base: 100, fetchOne })")(stranger);
  for (const hit of [true, false, true]) {
    log.length = 0; let answer: string;
    try { answer = (await Promise.all([form(hit, "s", keeper), ticks()]))[0]; } catch (error) { answer = "THROWS " + String(error); await ticks(); }
    console.log(name + " | " + hit + " | " + answer + " | " + log.join(" "));
  }
}
install(real); hooks.current = real; log.length = 0;
console.log(await form(true, "back", new Keeper()), await form(false, "back", new Keeper()), log.join(" "));
