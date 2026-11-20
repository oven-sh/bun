import { AsyncLocalStorage } from "node:async_hooks";

const out = [];
const log = text => out.push(String(text));
const show = value =>
  value === null || typeof value !== "object"
    ? `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`
    : value instanceof Promise
      ? "promise"
      : `{${Object.keys(value)}}`;
const storage = new AsyncLocalStorage();
const ready = Promise.resolve("ready");

class Base {
  async overridden(n) {
    return "base" + n;
  }
}
class Service extends Base {
  #hidden = 7;
  async never(n) {
    return n;
  }
  async nothing() {}
  async once(n) {
    await null;
    return n;
  }
  async thrice(n) {
    await null;
    await this.once(n);
    await ready;
    return this.#hidden + n;
  }
  async throwsAtOnce(n) {
    throw new Error("at once " + n);
  }
  async throwsSometimes(n) {
    if (n & 1) await null;
    throw new Error("sometimes " + n);
  }
  async returnsPromise(n) {
    return this.once(n);
  }
  async returnsFulfilled() {
    return ready;
  }
  async returnsThenable(n) {
    return { then: resolve => (log("then " + n), resolve(n)) };
  }
  async returnsObject(n) {
    return { n };
  }
  async returnsLateThenable(n) {
    const object = { n };
    queueMicrotask(() => (object.then = undefined));
    return object;
  }
  async overridden(n) {
    return "service " + (await super.overridden(n));
  }
  async deep(n) {
    return n ? await this.deep(n - 1) : "bottom";
  }
  async deepLate(n) {
    if (n) return await this.deepLate(n - 1);
    await null;
    return "late bottom";
  }
  async context() {
    const before = storage.getStore();
    await null;
    return before + " " + storage.getStore();
  }
  async defaults(a, b = (log("default"), 2), ...rest) {
    return a + b + rest.length;
  }
  async catches(n) {
    try {
      return await this.throwsSometimes(n);
    } catch (error) {
      return "caught " + error.message;
    } finally {
      log("finally " + n);
    }
  }
  plain(n) {
    return n;
  }
  plainPromise(n) {
    return Promise.resolve(n);
  }
  forwards(n) {
    return this.once(n);
  }
  forwardsNever(n) {
    return this.never(n);
  }
  plainThenable(n) {
    return { then: resolve => (log("plain then " + n), queueMicrotask(() => resolve(n))) };
  }
  throwsPlainly(n) {
    throw new TypeError("plainly " + n);
  }
  get getter() {
    return async n => "got " + n;
  }
}
const service = new Service();
const methods = Object.getOwnPropertyNames(Service.prototype).filter(name => name !== "constructor" && name !== "getter");
const receivers = [service, new Proxy(service, { get: (target, key) => { const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } })];
const functions = [async n => n, async n => (await null, -n), n => n, Service.prototype.never, Service.prototype.throwsAtOnce, Promise.resolve.bind(Promise)];

async function ticks(name, count) {
  for (let tick = 0; tick < count; tick++) {
    log(name + tick);
    await null;
  }
}
function crowd(count) {
  for (let k = 0; k < count; k++) void ticksQuietly(6 + (k % 3));
}
async function ticksQuietly(count) {
  for (let tick = 0; tick < count; tick++) await null;
}

async function awaitsMethod(receiver, name, n) {
  return await receiver[name](n);
}
async function awaitsEach(receiver, n) {
  log("never " + show(await receiver.never(n)));
  log("nothing " + show(await receiver.nothing(n)));
  log("once " + show(await receiver.once(n)));
  log("thrice " + show(await receiver.thrice(n)));
  log("promise " + show(await receiver.returnsPromise(n)));
  log("object " + show(await receiver.returnsObject(n)));
  log("thenable " + show(await receiver.returnsThenable(n)));
  log("late thenable " + show(await receiver.returnsLateThenable(n)));
  log("plain " + show(await receiver.plain(n)));
  log("plain thenable " + show(await receiver.plainThenable(n)));
  log("forwards " + show(await receiver.forwards(n)));
  log("defaults " + show(await receiver.defaults(n)) + show(await receiver.defaults(n, 1, 2, 3)));
  log("getter " + show(await receiver.getter(n)));
  return n;
}
async function usesResult(receiver, n) {
  const first = receiver.never(n);
  const second = receiver.once(n);
  log(show(first) + show(second));
  log(show(await first) + show(await second) + show(first));
  const [a, b] = await Promise.all([receiver.never(1), receiver.once(2)]);
  log(a + b);
  return receiver.never(n);
}
async function failures(receiver, n) {
  for (const name of ["throwsAtOnce", "throwsSometimes", "throwsPlainly", "missing"]) {
    try {
      log("no " + show(await receiver[name](n)));
    } catch (error) {
      log(error.constructor.name + " " + (name === "missing" ? "" : error.message));
    }
  }
  await receiver.throwsSometimes(n);
}
async function inLoops(list, rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (const call of list) {
      try {
        sum += Number(await call(round)) || 1;
      } catch {
        sum += 100;
      }
    }
  }
  return sum;
}
async function* steps(receiver) {
  yield await receiver.never(1);
  yield receiver.once(2);
  for (let k = 0; k < 2; k++) yield (await receiver.thrice(k)) + k;
}

process.on("unhandledRejection", error => log("unhandled " + error.message));
for (const waiting of [0, 15, 16, 17, 40]) {
  for (const receiver of receivers) {
    log(`-- ${waiting}`);
    crowd(waiting);
    const beside = ticks("t", 14);
    await awaitsEach(receiver, waiting);
    await beside;
    crowd(waiting);
    for (const name of methods) {
      try {
        log(name + " " + show(await awaitsMethod(receiver, name, 2)));
      } catch (error) {
        log(name + " " + error.message);
      }
    }
    crowd(waiting);
    log(show(await usesResult(receiver, 3)));
    await Promise.allSettled([failures(receiver, 0), failures(receiver, 1)]).then(all => log(all.map(one => one.reason?.message)));
    log(await storage.run("inside", () => awaitsMethod(receiver, "context")));
    log(await inLoops(functions, 5));
    for await (const step of steps(receiver)) log(show(step));
    receiver.throwsSometimes(waiting);
  }
}
const many = [];
for (let k = 0; k < 2000; k++) many.push(awaitsMethod(service, methods[k % methods.length], k & 3));
const kept = [];
for (const one of await Promise.allSettled(many)) kept.push(one.status === "fulfilled" ? show(one.value) : one.reason.message);
log(kept.filter((text, k) => k < 60 || k % 97 === 0).join("; "));
await new Promise(resolve => setImmediate(resolve));
console.log(out.join("\n"));
