// A FinalizationRegistry lies in a variable of a function that is suspended. Helpers that are only called share the variable's scope, and one of them is called again behind the suspension. It calls back all the same.
const called = [];
const note = form => void called.push(form);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = () => ({ payload: new Array(50).fill(0) });
function made(form) {
  const registry = new FinalizationRegistry(note);
  registry.register(target(), form);
  return registry;
}
function gate() {
  let settle;
  const waited = new Promise(resolve => (settle = resolve));
  return { waited, settle };
}
const forms = {
  "stored by a helper, across an await"(form) {
    const { waited, settle } = gate();
    (async () => {
      let registry = null;
      let count = 0;
      function load() { registry = made(form); }
      function bump() { return ++count; }
      load();
      await waited;
      return bump();
    })();
    return settle;
  },
  "stored by a helper, across a yield"(form) {
    function* steps() {
      let registry = null;
      let count = 0;
      function load() { registry = made(form); }
      function bump() { return ++count; }
      load();
      yield 0;
      yield bump();
    }
    const generator = steps();
    generator.next();
    return generator;
  },
  "read by a helper in front of the await"(form) {
    const { waited, settle } = gate();
    (async () => {
      const registry = made(form);
      let count = 0;
      function look() { return registry !== null; }
      function bump() { return ++count; }
      look();
      await waited;
      return bump();
    })();
    return settle;
  },
  "stored by a helper that another helper calls, across an await"(form) {
    const { waited, settle } = gate();
    (async () => {
      let registry = null;
      let count = 0;
      function bump() { return ++count; }
      function load() { registry = made(form); bump(); }
      load();
      await waited;
      return bump();
    })();
    return settle;
  },
};
const kept = [];
for (const form in forms) {
  kept.push(forms[form](form));
  await sleep(1);
}
for (let round = 0; round < 40 && called.length < Object.keys(forms).length; round++) {
  Bun.gc(true);
  await sleep(5);
}
console.log(called.sort().join("\n"));
console.log(kept.length);
