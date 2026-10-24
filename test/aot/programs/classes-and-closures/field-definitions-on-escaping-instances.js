// Field definitions of instances that reach code nobody sees: order of keys, closures over `this`, and every case where a definition is more than a store.
const seen = [];
const handlers = JSON.parse('[["first"], ["second"]]').map(([name]) => [object => seen.push(name, Object.keys(object).join())]);
function escape(object, index) {
  handlers[index % handlers.length][0](object);
  return object;
}

class Context {
  #raw;
  #request;
  env = {};
  #variables;
  finalized = false;
  error;
  #status = 200;
  #path;
  constructor(raw, options) {
    this.#raw = raw;
    if (options) {
      this.env = options.env;
      this.#path = options.path;
    }
  }
  text = value => value + this.#path + this.#status;
  status = code => {
    this.#status = code;
    return this;
  };
  last = "last";
  get raw() {
    return this.#raw;
  }
  static has(object) {
    return #variables in object;
  }
}

for (let i = 0; i < 4; i++) {
  const context = escape(new Context("raw" + i, i & 1 ? { env: { i }, path: "/p" + i } : undefined), i);
  console.log(context.status(201 + i).text("t"), context.raw, JSON.stringify(context), Context.has(context));
}
console.log(seen.join(" "));

// A base class that returns another object: the fields land on that object, and a second definition of a private name throws.
class ReturnsArgument {
  constructor(object) {
    return object;
  }
}
class Stamp extends ReturnsArgument {
  #mark = "marked";
  visible = 1;
  static read(object) {
    return object.#mark;
  }
}
const target = { before: 0 };
new Stamp(target);
console.log(Stamp.read(target), Object.keys(target).join());
try {
  new Stamp(target);
} catch (error) {
  console.log(error.constructor.name, Object.keys(target).join());
}
const stampedContext = new Context("stamped");
new Stamp(stampedContext);
console.log(Stamp.read(stampedContext), Object.keys(stampedContext).join());

// An initializer that throws leaves the earlier fields, and one that reads `this` sees what is defined so far.
let halfBuilt;
class Throws {
  a = 1;
  #b = 2;
  c = ((halfBuilt = this), Object.keys(this).join() + (#d in this) + (#b in this));
  #d = 4;
  e = (() => {
    throw new RangeError("in initializer");
  })();
  f = 6;
}
try {
  new Throws();
} catch (error) {
  console.log(error.message, JSON.stringify(halfBuilt));
}

// A definition is no store: setters and read-only properties above the object do not count, an object that is not extensible does.
class WithSetter {
  set watched(value) {
    console.log("setter ran");
  }
}
Object.defineProperty(WithSetter.prototype, "fixed", { value: "inherited", writable: false });
class Below extends WithSetter {
  watched = "own";
  fixed = "own too";
}
console.log(JSON.stringify(escape(new Below(), 0)));

class Closes {
  constructor() {
    Object.preventExtensions(this);
  }
}
class BelowClosed extends Closes {
  late = 1;
}
try {
  new BelowClosed();
} catch (error) {
  console.log(error.constructor.name);
}

// new.target is a subclass, a bound function, a proxy, or any function handed to Reflect.construct.
class Heir extends Context {
  own = "heir";
  #more = 1;
  more() {
    return this.#more;
  }
}
const heir = escape(new Heir("heir", { env: 1, path: "/h" }), 1);
console.log(heir.text("x"), heir.more(), Object.keys(heir).join(), heir instanceof Context);
function Plain() {}
Plain.prototype.marker = "plain";
const reflected = Reflect.construct(Context, ["reflected"], Plain);
console.log(reflected.marker, reflected.raw, reflected instanceof Context, Object.keys(reflected).join());
const proxied = new (new Proxy(Context, {}))("proxied");
console.log(proxied.raw, Object.keys(proxied).join());

// Objects that lose fields and get them back keep the order a program can see.
const changed = new Context("changed");
delete changed.finalized;
changed.finalized = "again";
Object.defineProperty(changed, "error", { get: () => "getter", enumerable: true, configurable: true });
console.log(Object.keys(changed).join(), changed.error, changed.text("y"));

// Another parent at run time: super(..) constructs with it, and the fields of the class land on what it returns.
class OtherBase {
  constructor(raw) {
    this.other = raw;
  }
}
for (let i = 0; i < 4; i++) {
  if (i === 2) Object.setPrototypeOf(Heir, OtherBase);
  const relinked = escape(new Heir("relinked" + i, { env: i, path: "/r" }), i);
  console.log(Object.keys(relinked).join(), relinked.more(), relinked.other, relinked instanceof Context, Context.has(relinked));
}
