// Promise.prototype.finally of a thenable, Promise.try and the steps of generators: what code of an operand hands back is read, resolved and handed out.
{
  const log = [];
  class Thenable {
    constructor(value) {
      this.value = value;
    }
    then(onFulfilled, onRejected) {
      log.push("then called");
      return onFulfilled(this.value);
    }
    static get [Symbol.species]() {
      log.push("species");
      return Promise;
    }
  }
  function run() {
    const holder = { reads: 0 };
    const value = {
      get then() {
        holder.reads++;
        log.push("then of the value read");
        return undefined;
      },
    };
    const answer = Promise.prototype.finally.call(new Thenable(value), () => {
      log.push("finally ran");
      return {
        get then() {
          holder.reads += 10;
          log.push("then of what the callback answered");
          return undefined;
        },
      };
    });
    return [holder, answer];
  }
  const [holder, answer] = run();
  console.log(holder.reads);
  await answer;
  await new Promise(resolve => setTimeout(resolve, 2));
  console.log(holder.reads, log.join(" | "));
}

{
  function run() {
    const holder = { reads: 0 };
    const argument = {
      get then() {
        holder.reads++;
        return undefined;
      },
    };
    const promise = Promise.try(first => first, argument);
    return [holder, promise, argument];
  }
  const [holder, promise, argument] = run();
  console.log(holder.reads);
  console.log((await promise) === argument, holder.reads);
}

{
  function* make(held) {
    const sent = yield held;
    yield sent;
  }
  async function* makeAsync(held) {
    yield held;
  }
  function step() {
    const held = { tag: 1 };
    const generator = make(held);
    const next = Object.getPrototypeOf(Object.getPrototypeOf(generator)).next;
    const first = next.call(generator);
    first.value.tag = 2;
    const sent = { tag: 5 };
    const second = next.call(generator, sent);
    second.value.tag = 6;
    return `${held.tag} ${first.value === held} ${sent.tag} ${second.value === sent}`;
  }
  console.log(step());
  const held = { tag: 1 };
  const result = await makeAsync(held).next();
  result.value.tag = 3;
  console.log(held.tag, result.value === held);
}
