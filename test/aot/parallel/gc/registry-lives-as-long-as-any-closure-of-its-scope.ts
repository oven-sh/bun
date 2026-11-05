// A FinalizationRegistry calls back while any closure made in the scope of the name that holds it lives, also one that does not name it, however the registry came to that name.
const called: string[] = [];
const note = (form: string) => void called.push(form);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const make = () => new FinalizationRegistry<string>(note);
const makeBoth = (form: string) => ({ registry: make(), form });
const target = () => ({ payload: new Array(50).fill(0) });
type Kept = () => unknown;
type Registers = { register(target: object, held: string): void };
class Named extends FinalizationRegistry<string> {
  label = "named";
}

// Each form registers an object that nothing holds, through a closure that nothing holds afterwards, and returns a closure of the same scope.
const forms: Record<string, (form: string) => Kept> = {
  "made in place"(form) {
    const registry = new FinalizationRegistry<string>(note);
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "returned by a helper"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "one arm of a conditional"(form) {
    const registry = form.length > 0 ? make() : undefined;
    const watch = () => registry?.register(target(), form);
    watch();
    return () => form;
  },
  "a member of a pattern"(form) {
    const { registry } = makeBoth(form);
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "an element of a pattern"(form) {
    const [, registry] = [form, make()] as const;
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "assigned later"(form) {
    let registry: FinalizationRegistry<string> | undefined;
    const watch = () => registry!.register(target(), form);
    registry = make();
    watch();
    return () => form;
  },
  "assigned later to a name that may hold anything"(form) {
    let registry: any;
    const watch = () => registry.register(target(), form);
    registry = make();
    watch();
    return () => form;
  },
  "a parameter"(form) {
    return ((registry: FinalizationRegistry<string>) => {
      const watch = () => registry.register(target(), form);
      watch();
      return () => form;
    })(make());
  },
  "a parameter that may be anything"(form) {
    return ((registry: any) => {
      const watch = () => registry.register(target(), form);
      watch();
      return () => form;
    })(make());
  },
  "a name of unknown type"(form) {
    const registry: unknown = make();
    const watch = () => (registry as Registers).register(target(), form);
    watch();
    return () => form;
  },
  "a name of a type with one of its methods"(form) {
    const registry: Registers = make();
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "an instance of a class that extends it"(form) {
    const registry = new Named(note);
    const watch = () => registry.register(target(), form);
    watch();
    return () => form;
  },
  "a name of a block"(form) {
    let kept: Kept;
    {
      const registry = make();
      const watch = () => registry.register(target(), form);
      watch();
      kept = () => form;
    }
    return kept;
  },
  "a name of one turn of a loop"(form) {
    const kept: Kept[] = [];
    for (let turn = 0; turn < 2; turn++) {
      const registry = make();
      const watch = () => registry.register(target(), form + " " + turn);
      watch();
      kept.push(() => turn);
    }
    return () => kept;
  },
  "the closure that stays captures nothing"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return () => 1;
  },
  "the closure that stays is made by another closure"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    const later = () => () => () => form;
    watch();
    return later()();
  },
  "the closure that stays is a declared function"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return stays;
    function stays() {
      return form;
    }
  },
  "the closure that stays is a method"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return {
      stays() {
        return form;
      },
    }.stays;
  },
  "the closure that stays is a class"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return class {
      form = form;
    } as unknown as Kept;
  },
  "the closure that stays is async"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return async () => form;
  },
  "the closure that stays is a generator"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return function* () {
      yield form;
    };
  },
};

const kept: Kept[] = [];
async function run(form: string) {
  kept.push(forms[form](form));
  await sleep(1);
}
for (const form in forms) await run(form);
const expected = Object.keys(forms).length + 1;
for (let round = 0; round < 40 && called.length < expected; round++) {
  Bun.gc(true);
  await sleep(5);
}
console.log(called.sort().join("\n"));
console.log(kept.length);
