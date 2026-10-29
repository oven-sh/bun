// Closures handed to the addon, which calls them at once, in a later call, from the event loop and at the request of another thread: what they capture changes while compiled code holds it.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function say(label, value) {
  console.log(String(++at).padStart(3) + " " + label + ": " + JSON.stringify(value));
}

function counter() {
  let count = 0;
  let last = "none";
  const record = { hits: 0 };
  return {
    bump(by) {
      count += by;
      last = "bumped by " + by;
      record.hits++;
      return count;
    },
    read() {
      let sum = 0;
      for (let round = 0; round < 100; round++) sum += count + record.hits;
      return [sum, count, last, record.hits];
    },
    readAround(change) {
      let sum = 0;
      for (let round = 0; round < 50; round++) {
        sum += count;
        change(round);
        sum += count * 2 + record.hits;
      }
      return [sum, last];
    },
  };
}

{
  const c = counter();
  say("called at once", [attack.call(undefined, c.bump, 5), c.read()]);
  attack.keep(0, c.bump);
  say("called in a later call", [attack.callKept(0, 7), c.read()]);
  say("called inside a loop that reads what it captures", c.readAround(round => attack.callKept(0, round)));
  say("read back from the addon", [attack.keptValue(0) === c.bump, attack.keptValue(0)(1), c.read()]);
}
{
  const c = counter();
  const methods = { run: c.bump };
  say("reached through an object", [attack.call(undefined, attack.read(methods, "run"), 3), c.read()]);
  let made = 0;
  const makes = () => ({ made: ++made });
  say("a closure that makes objects", [attack.callAndStore(makes, "tag", 1), attack.callAndStore(makes, "tag", 2), made]);
}
{
  class Account {
    #balance = 0;
    total = 0;
    deposit(amount) {
      this.#balance += amount;
      this.total += amount;
      return this.#balance;
    }
    get balance() {
      return this.#balance;
    }
  }
  const account = new Account();
  say("a method called with its object", [attack.call(account, account.deposit, 10), account.balance, account.total]);
  say("a method called with another object", attack.call({}, account.deposit, 10).replace(/:.*/, ""));
  const bound = account.deposit.bind(account);
  attack.keep(1, bound);
  let sum = 0;
  for (let round = 0; round < 50; round++) {
    sum += account.balance + account.total;
    attack.callKept(1, 1);
  }
  say("a bound method called inside a loop", [sum, account.balance, account.total]);
}
{
  const thrower = () => {
    throw new RangeError("from the closure");
  };
  say("a closure that throws", attack.call(undefined, thrower));
  let depth = 0;
  const again = n => (depth++, n > 0 ? attack.call(undefined, again, n - 1) : "bottom");
  say("the addon and the program call each other", [again(20), depth]);
}
{
  const c = counter();
  // Two pieces of work complete in either order, so what is printed does not depend on it.
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  attack.keep(2, by => first.resolve(c.bump(by)));
  attack.keep(3, by => second.resolve(c.bump(by)));
  say("work queued", [attack.callKeptFromWork(2, 4), attack.callKeptFromWork(3, 6), c.read()]);
  const spun = c.read();
  say("nothing ran meanwhile", spun);
  say("work completed", [Math.max(await first.promise, await second.promise), c.read().slice(0, 2), c.read()[3]]);
}
{
  const c = counter();
  const { promise, resolve } = Promise.withResolvers();
  say("sent from another thread", [attack.callFromThread(by => resolve(c.bump(by)), 9), c.read()]);
  say("arrived", [await promise, c.read()]);
}
{
  async function waits(gate, record) {
    const before = record.value;
    await gate;
    return [before, record.value];
  }
  const record = { value: 1 };
  attack.keep(4, record);
  const { promise, resolve } = Promise.withResolvers();
  const waiting = waits(promise, record);
  attack.keep(5, () => (attack.storeIntoKept(4, "value", 2), resolve()));
  attack.callKeptFromWork(5, 0);
  say("a field changed while an async function waits", await waiting);
}
