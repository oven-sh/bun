// A FinalizationRegistry calls back while any closure made in the scope of a name lives, also where the name holds an object that holds the registry, where the name is `this`, and where it is a parameter that may be anything.
// Todo: Plain Bun prints the seven forms. The executable prints none: a closure holds the names that it reads and, of the other names of its scope, those that may hold a FinalizationRegistry themselves. A registry behind another object, behind `this`, or in a parameter of a method dies with the last closure that names it.
const called: string[] = [];
const note = (form: string) => void called.push(form);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const make = () => new FinalizationRegistry<string>(note);
const target = () => ({ payload: new Array(50).fill(0) });
const registerWith = (registry: any, form: string) => registry.register(target(), form);
type Kept = () => unknown;
class Tracker {
  registry = make();
}
class Watcher extends FinalizationRegistry<string> {
  watch(form: string) {
    const watch = () => this.register(target(), form);
    watch();
    return () => form;
  }
}
const holder = {
  handsOn(registry: any, form: string) {
    const watch = () => registerWith(registry, form);
    watch();
    return () => form;
  },
  calls(registry: any, form: string) {
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
};

// Each form registers an object that nothing holds, through a closure that nothing holds afterwards, and returns a closure of the same scope.
const forms: Record<string, (form: string) => Kept> = {
  "a property of an object"(form) {
    const state = { registry: make() };
    const watch = () => state.registry.register(target(), form);
    watch();
    return () => form;
  },
  "an element of an array"(form) {
    const list = [make()];
    const watch = () => list[0].register(target(), form);
    watch();
    return () => form;
  },
  "a value of a Map"(form) {
    const map = new Map([[form, make()]]);
    const watch = () => map.get(form)!.register(target(), form);
    watch();
    return () => form;
  },
  "a field of an instance"(form) {
    const tracker = new Tracker();
    const watch = () => tracker.registry.register(target(), form);
    watch();
    return () => form;
  },
  "this of a class that extends it"(form) {
    return new Watcher(note).watch(form);
  },
  "a parameter of a method that is only handed on"(form) {
    return holder.handsOn(make(), form);
  },
  "a parameter of a method whose method is called"(form) {
    return holder.calls(make(), form);
  },
};

const kept: Kept[] = [];
async function run(form: string) {
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
