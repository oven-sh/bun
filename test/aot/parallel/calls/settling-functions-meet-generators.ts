// A function that settles a promise meets functions and generators in one list. All of them reach code that nobody has read.
// Under: --aot-check=FlowFixpoint: whether unseen code sees what the members of such a family hold went by the class of the first member, so the flow was not closed.
const called: string[] = [];
const note = (form: string) => void called.push(form);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const make = () => new FinalizationRegistry<string>(note);
const target = () => ({ payload: new Array(50).fill(0) });
type Kept = () => unknown;

const forms: Record<string, (form: string) => Kept> = {
  "an async function"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return async () => form;
  },
  "a generator function"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    return function* () {
      yield form;
    };
  },
  "a generator that has not begun"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    function* stays() {
      yield form;
      yield form;
    }
    return stays() as unknown as Kept;
  },
  "a generator that has begun"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    function* stays() {
      yield form;
      yield form;
    }
    const generator = stays();
    generator.next();
    return generator as unknown as Kept;
  },
  "a settling function"(form) {
    const registry = make();
    const watch = () => registry.register(target(), form);
    watch();
    let settle: Kept = () => form;
    const waited = new Promise(resolve => (settle = resolve as Kept));
    (async () => {
      await waited;
      return form;
    })();
    return settle;
  },
};

const kept: Kept[] = [];
async function run(form: string) {
  kept.push(forms[form](form));
  await sleep(1);
}
for (const form in forms) await run(form);
const expected = Object.keys(forms).length;
for (let round = 0; round < 40 && called.length < expected; round++) {
  Bun.gc(true);
  await sleep(5);
}
console.log(called.length <= expected, kept.length);
console.log(kept.map(one => typeof one).join(" "));
