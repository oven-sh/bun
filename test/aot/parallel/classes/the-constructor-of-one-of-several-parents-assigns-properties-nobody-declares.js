// `class Node { constructor(raw) { this.raw = raw; } }; class C extends parents[n] {}`: the assignment makes the property, so it first asks the objects above for a setter or a read-only property of the name.
// Nobody proves which class stands above C, so there is no class to ask. Flow has looked at every object that may stand there: where none has the name, the assignment is a store into the field of C.
// It went to a stub by name for every instance once: 40,000 arrivals more in the first loop.
// COUNT: arrivals <= 10000
const say = (...words) => console.log(words.join(" "));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name + ": " + error.message.split(" (evaluating")[0];
  }
};
const pick = process.argv.length > 50 ? 1 : 0;
const context = { name: "context" };
const raw = { k: 1 };

// Nothing above has the names.
{
  class Node {
    constructor(context, raw) {
      this.context = context;
      this.raw = raw;
    }
  }
  class Other {
    constructor(context, raw) {
      this.raw = { k: 0 };
    }
  }
  const Root = [Node, Other][pick];
  class C extends Root {
    get k() {
      return this.raw.k;
    }
  }
  class D extends Root {
    own = 2;
    get k() {
      return this.raw.k + this.own;
    }
  }
  const kinds = [C, D];
  let sum = 0;
  let last;
  for (let i = 0; i < 40000; i++) {
    last = new kinds[i & 1](context, raw);
    sum += last.k;
  }
  say("sum", sum, Object.keys(last).join(), last.context === context);
}

// One of the parents has a setter of the name, the other a property that may not be written.
{
  const seen = [];
  class Node {
    constructor(raw) {
      this.held = raw;
      this.fixed = raw;
    }
    set held(value) {
      seen.push(value.k);
    }
  }
  Object.defineProperty(Node.prototype, "fixed", { value: "fixed", writable: false });
  class Other {
    constructor(raw) {
      this.held = raw;
    }
  }
  for (const Root of [Node, Other]) {
    class C extends Root {}
    let made;
    const answer = attempt(() => {
      for (let i = 0; i < 300; i++) made = new C(raw);
      return "made";
    });
    say(Root.name, answer, made ? Object.keys(made).join() : "nothing", seen.length);
  }
}

// The class itself has the setter, or the class between.
{
  let stored = 0;
  class Node {
    constructor(raw) {
      this.kept = raw;
    }
  }
  class Other {}
  const Root = [Node, Other][pick];
  class Between extends Root {
    set kept(value) {
      stored += value.k;
    }
  }
  class C extends Between {}
  class D extends Root {
    set kept(value) {
      stored += 10 * value.k;
    }
  }
  class E extends Root {}
  for (let i = 0; i < 300; i++) for (const Class of [C, D, E]) new Class(raw);
  say(stored, Object.keys(new C(raw)).length, Object.keys(new D(raw)).length, Object.keys(new E(raw)).join());
}

// A setter comes while the loop runs, on the parent's prototype and on that of the class, and goes again.
{
  class Node {
    constructor(raw) {
      this.late = raw;
    }
  }
  class Other {}
  const Root = [Node, Other][pick];
  class C extends Root {}
  let caught = 0;
  const own = [];
  for (let i = 0; i < 5000; i++) {
    if (i === 1000) Object.defineProperty(Node.prototype, "late", { set(value) { caught++; }, configurable: true });
    if (i === 2000) delete Node.prototype.late;
    if (i === 3000) Object.defineProperty(C.prototype, "late", { set(value) { caught += 10; }, configurable: true });
    if (i === 4000) delete C.prototype.late;
    const has = Object.hasOwn(new C(raw), "late");
    if (own[own.length - 1]?.has !== has) own.push({ i, has });
  }
  say(caught, own.map(({ i, has }) => i + ":" + has).join(" "));
}

// The prototype of the class is changed, and what new.target asks for is of no class below.
{
  class Node {
    constructor(raw) {
      this.moved = raw;
    }
  }
  class Other {}
  const Root = [Node, Other][pick];
  class C extends Root {}
  let caught = 0;
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    if (i === 1500) Object.setPrototypeOf(C.prototype, { set moved(value) { caught++; } });
    sum += Object.hasOwn(new C(raw), "moved") ? 1 : 0;
  }
  function Plain() {}
  Plain.prototype = { set moved(value) { caught += 100; } };
  const plain = Reflect.construct(Root, [raw], Plain);
  say(sum, caught, Object.keys(plain).length, Object.getPrototypeOf(plain) === Plain.prototype);
}
