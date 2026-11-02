// A FinalizationRegistry calls back while any closure made in the scope of the name that holds it lives, also where nothing is written about what the name holds.
const called = [];
const note = form => void called.push(form);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const make = () => new FinalizationRegistry(note);
const target = () => ({ payload: new Array(50).fill(0) });
const registerWith = (registry, form) => registry.register(target(), form);

// Each form registers an object that nothing holds, through a closure that nothing holds afterwards, and returns a closure of the same scope.
const forms = {
  "made in place"(form) {
    const registry = new FinalizationRegistry(note);
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "assigned later"(form) {
    let registry;
    const watch = () => registry.register(target(), form);
    registry = make();
    watch();
    return () => form;
  },
  "assigned by another closure"(form) {
    let registry;
    const fill = () => {
      registry = make();
    };
    const watch = () => registry.register(target(), form);
    fill();
    watch();
    return () => form;
  },
  "a parameter whose method is called"(form) {
    return (registry => {
      const watch = () => registry.register(target(), form);
      watch();
      return () => form;
    })(make());
  },
  "a parameter that is only handed on"(form) {
    return (registry => {
      const watch = () => registerWith(registry, form);
      watch();
      return () => form;
    })(make());
  },
  "a parameter with a default"(form) {
    return ((registry = make()) => {
      const watch = () => registerWith(registry, form);
      watch();
      return () => form;
    })();
  },
  "one of the rest of the arguments"(form) {
    return ((...[registry]) => {
      const watch = () => registerWith(registry, form);
      watch();
      return () => form;
    })(make());
  },
};

const kept = [];
async function run(form) {
  kept.push(forms[form](form));
  await sleep(1);
}
for (const form in forms) await run(form);
for (let round = 0; round < 40 && called.length < kept.length; round++) {
  Bun.gc(true);
  await sleep(5);
}
console.log(called.sort().join("\n"));
console.log(kept.length);
