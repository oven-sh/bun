// A FinalizationRegistry is stored into a place that stays and that nobody ever reads. It calls back all the same.
const called = [];
const note = form => void called.push(form);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = () => ({ payload: new Array(50).fill(0) });
function made(form) {
  const registry = new FinalizationRegistry(note);
  registry.register(target(), form);
  return registry;
}
let ofTheModule = null;
const holder = { registry: null, other: 1 };
const list = [];
const table = new Map();
class Keeper {
  #hidden = null;
  shown = null;
  static ofTheClass = null;
  hide(registry) { this.#hidden = registry; }
  show(registry) { this.shown = registry; }
}
const keeper = new Keeper();
const forms = {
  "a name of a function that a closure stores into"(form) {
    let kept = null;
    function keep(registry) { kept = registry; }
    keep(made(form));
    return keep;
  },
  "a name of the module"(form) {
    ofTheModule = made(form);
    return 1;
  },
  "a member of a literal"(form) {
    holder.registry = made(form);
    return holder.other;
  },
  "an element of a list"(form) {
    list.push(made(form));
    return 1;
  },
  "a value of a Map"(form) {
    table.set(form, made(form));
    return 1;
  },
  "a private field"(form) {
    keeper.hide(made(form));
    return 1;
  },
  "a field"(form) {
    keeper.show(made(form));
    return 1;
  },
  "a static field"(form) {
    Keeper.ofTheClass = made(form);
    return 1;
  },
  "a member of a literal that a closure holds"(form) {
    const local = { registry: made(form), read: form };
    return () => local.read;
  },
  "a field of an instance that a closure holds"(form) {
    const local = new Keeper();
    local.show(made(form));
    return () => local.hide;
  },
  "a local of a suspended function, read only in front of the await"(form) {
    let settle;
    const waited = new Promise(resolve => (settle = resolve));
    (async () => {
      const registry = made(form);
      await waited;
      return form;
    })();
    return settle;
  },
  "a member of a local literal of a suspended function"(form) {
    let settle;
    const waited = new Promise(resolve => (settle = resolve));
    (async () => {
      const local = { registry: made(form), read: form };
      await waited;
      return local.read;
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
