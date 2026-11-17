// Only a call that is suspended leads to a FinalizationRegistry: through its receiver, or through a scope around its function. The registry calls back all the same.
const called = [];
const note = form => void called.push(form);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = () => ({ payload: new Array(50).fill(0) });
function make(form) {
  const registry = new FinalizationRegistry(note);
  registry.register(target(), form);
  return registry;
}
function wait() {
  let settle;
  const waited = new Promise(resolve => (settle = resolve));
  return { settle, waited };
}
class Watcher {
  constructor(form) {
    this.registry = make(form);
  }
  async waits(waited) {
    await waited;
  }
  *steps() {
    yield 1;
    yield 2;
  }
  async *streams(waited) {
    yield 1;
    await waited;
  }
}
async function waitsOnBehalfOfReceiver(waited) {
  await waited;
}
const forms = {
  "the receiver of an async method that waits"(form) {
    const { settle, waited } = wait();
    new Watcher(form).waits(waited);
    return settle;
  },
  "the receiver of a generator method that has not begun"(form) {
    return new Watcher(form).steps();
  },
  "the receiver of a generator method that has begun"(form) {
    const generator = new Watcher(form).steps();
    generator.next();
    return generator;
  },
  "the receiver of an async generator method that waits"(form) {
    const { settle, waited } = wait();
    const generator = new Watcher(form).streams(waited);
    generator.next().then(() => generator.next());
    return settle;
  },
  "the receiver that call() hands to an async function"(form) {
    const { settle, waited } = wait();
    waitsOnBehalfOfReceiver.call(new Watcher(form), waited);
    return settle;
  },
  "a name around an async function that waits, assigned by a closure"(form) {
    const { settle, waited } = wait();
    let registry = null;
    const assign = () => void (registry = make(form));
    assign();
    async function stays() {
      await waited;
    }
    stays();
    return settle;
  },
  "a name around a generator that has begun, assigned by a closure"(form) {
    let registry = null;
    const assign = () => void (registry = make(form));
    assign();
    function* stays() {
      yield 1;
      yield 2;
    }
    const generator = stays();
    generator.next();
    return generator;
  },
  "a name two functions out of an async arrow function that waits"(form) {
    const { settle, waited } = wait();
    const registry = make(form);
    const read = () => registry;
    const start = () => (async () => void (await waited))();
    start();
    return settle;
  },
};
const kept = [];
for (const form in forms) {
  kept.push(forms[form](form));
  await sleep(1);
}
for (let round = 0; round < 40 && called.length < kept.length; round++) {
  Bun.gc(true);
  await sleep(5);
}
console.log(called.sort().join("\n"));
console.log(kept.length);
