// Flags: --no-compile-function-source
// Reference: bun build --compile
// An executable without the text of its functions spells a call from the name of what is called. That name has the round brackets that end an optional chain,
// as the quote of an executable with the text has: `(o?.a).m`. No call here has arguments, because without the text none are spelled.
const o = { one: 1, a: { b: {} } };
function tell(label, run) {
  try {
    run(o, "key");
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.message);
  }
}
// Which round brackets each row writes is what is asked.
// prettier-ignore
{
  tell("chain called", o => (o?.one)());
  tell("longer chain called", o => (o?.a.b)());
  tell("member called", o => (o?.a).m1());
  tell("member of a longer chain called", o => (o?.a.b).m2());
  tell("member of a member called", o => (o?.a).b.m3());
  tell("element called", (o, k) => (o?.a)[k]());
  tell("member constructed", o => new (o?.a).M4());
  tell("chain that goes on called", o => o?.a.m5());
  tell("chain that goes on behind brackets called", o => (o?.a)?.m6());
}
