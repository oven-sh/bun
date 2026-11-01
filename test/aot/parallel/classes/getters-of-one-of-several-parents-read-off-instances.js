// `class A extends parents[n] {}; new A().raw`: the getter lies on the prototype of a parent that is one of several, so nothing says at build time which function the name answers.
// Flow has seen the getters that the read calls. Each class asks a site of its own, which remembers what it found for the Structure of the object, and the getter that comes is called directly.
// The read went to a stub by name for every object once, and two classes in turn found nothing remembered there: 103,035 arrivals in this program.
// COUNT: arrivals <= 12000
const say = (...words) => console.log(words.join(" "));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name + ": " + error.message.split(" (evaluating")[0];
  }
};
const pick = process.argv.length > 50 ? 1 : 0;

function parents() {
  class Node {
    #raw;
    constructor(raw) {
      this.#raw = raw;
    }
    get raw() {
      return this.#raw;
    }
    get self() {
      return this;
    }
    get fails() {
      throw new RangeError("from the getter of Node");
    }
  }
  class Other {
    get raw() {
      return { k: 0 };
    }
    get self() {
      return null;
    }
    get fails() {
      return "no failure";
    }
  }
  return [Node, Other];
}

// Two classes in turn at one read.
{
  const Root = parents()[pick];
  const Named = Base => class extends Base {};
  class A extends Named(Root) {}
  class B extends Root {
    own = 1;
  }
  const kinds = [A, B];
  const raw = { k: 1 };
  let sum = 0;
  let same = 0;
  for (let i = 0; i < 40000; i++) {
    const made = new kinds[i & 1](raw);
    sum += made.raw.k;
    if (made.self === made) same++;
  }
  say("sum", sum, same);
  say(attempt(() => new A(raw).fails), attempt(() => new B(raw).fails));
}

// What the name answers changes while the loop runs: each change is seen by the next read.
{
  const [Node, Other] = parents();
  const Root = [Node, Other][pick];
  class A extends Root {}
  class B extends Root {}
  const kinds = [A, B];
  const raw = { k: 1 };
  const seen = [];
  const note = (turn, value) => {
    const text = typeof value === "object" && value ? "k" + value.k : String(value);
    if (seen[seen.length - 1]?.text !== text) seen.push({ turn, text });
  };
  const shadowed = new A(raw);
  for (let i = 0; i < 9000; i++) {
    if (i === 1000) Object.defineProperty(Node.prototype, "raw", { get() { return { k: 2 }; }, configurable: true });
    if (i === 2000) Object.defineProperty(A.prototype, "raw", { get() { return { k: 3 }; }, configurable: true });
    if (i === 3000) delete A.prototype.raw;
    if (i === 4000) Object.defineProperty(Node.prototype, "raw", { value: { k: 4 }, configurable: true, writable: true });
    if (i === 5000) delete Node.prototype.raw;
    if (i === 6000) Object.setPrototypeOf(A.prototype, Other.prototype);
    if (i === 7000) Object.setPrototypeOf(A.prototype, null);
    if (i === 8000) Object.setPrototypeOf(A.prototype, { get raw() { return { k: 5 }; } });
    note(i, new kinds[0](raw).raw);
  }
  say(seen.map(({ turn, text }) => turn + ":" + text).join(" "));
  say(attempt(() => new B(raw).raw), attempt(() => shadowed.raw.k));
}

// One object among many has a property of its own under the name, or another prototype.
{
  const [Node, Other] = parents();
  const Root = [Node, Other][pick];
  class A extends Root {}
  const raw = { k: 1 };
  const objects = [];
  for (let i = 0; i < 3000; i++) objects.push(new A(raw));
  Object.defineProperty(objects[1000], "raw", { value: { k: 10 } });
  objects[1500].extra = 1;
  Object.defineProperty(objects[2000], "raw", { get() { return { k: 20 }; } });
  Object.setPrototypeOf(objects[2500], Other.prototype);
  Object.setPrototypeOf(objects[2600], { raw: { k: 30 } });
  Object.freeze(objects[2700]);
  let sum = 0;
  for (let round = 0; round < 3; round++) for (const object of objects) sum += object.raw.k;
  say("sum", sum);
}

// The getter reads a private name, and the object at hand is not one that has it.
{
  const [Node, Other] = parents();
  const Root = [Node, Other][pick];
  class A extends Root {}
  const raw = { k: 1 };
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += new A(raw).raw.k;
  const stranger = Object.create(A.prototype);
  say(sum, attempt(() => stranger.raw), attempt(() => Reflect.get(new A(raw), "raw", {})), Reflect.get(new A(raw), "raw", new A({ k: 7 })).k);
}

// A class that is evaluated again and again, below each parent in turn.
{
  const both = parents();
  const below = Base => class extends Base {};
  const raw = { k: 1 };
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    const Class = below(both[i & 1]);
    sum += new Class(raw).raw.k;
  }
  say("sum", sum);
}
