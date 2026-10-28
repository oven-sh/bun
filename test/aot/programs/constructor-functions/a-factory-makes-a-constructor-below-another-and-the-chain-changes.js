// A factory makes a constructor function and puts its prototype object below another function's. The stores of the constructor create own fields
// until something above the new object answers to one of the names.
const hide = new Function("value", "return value");
function Base(id) {
  this.id = id;
}
Object.defineProperties(Base.prototype, {
  label: {
    get() {
      return "label " + this.id + " " + this.name;
    },
  },
});
function build(Above, extras) {
  function Made(id, name, size) {
    this.id = id;
    this.name = name;
    this.size = size;
    this.done = undefined;
    for (let i = 0; i < extras.length; i++) this[extras[i].key] = extras[i].value;
  }
  Object.setPrototypeOf(Made.prototype, Above.prototype);
  Object.setPrototypeOf(Made, Above);
  return Made;
}
const log = [];
function show(title, object) {
  log.push(title + ": " + JSON.stringify(object) + " keys " + Object.keys(object).join() + " label " + object.label + " proto " + (Object.getPrototypeOf(object) === holder.Made.prototype));
}
const holder = hide({ Made: build(Base, [{ key: "extra", value: 1 }]) });
function make(i) {
  return new holder.Made(i, "n" + i, i * 2);
}
function attempt(title, i) {
  try {
    show(title, make(i));
  } catch (error) {
    log.push(title + " threw " + error.constructor.name);
  }
}
for (let i = 0; i < 300; i++) make(i);
attempt("plain", 1);

// A setter comes above the objects.
let stored = [];
Object.defineProperty(Base.prototype, "size", {
  set(value) {
    stored.push(value);
  },
  get() {
    return "from the getter";
  },
  configurable: true,
});
attempt("a setter on the base", 6);
log.push("stored " + stored.join() + " size " + make(7).size + " own " + Object.hasOwn(make(8), "size"));
delete Base.prototype.size;
attempt("the setter is gone", 9);

// A property that cannot be written, on the function's own prototype object.
Object.defineProperty(holder.Made.prototype, "name", { value: "fixed", writable: false, configurable: true });
attempt("a read-only name", 10);
delete holder.Made.prototype.name;
attempt("the read-only name is gone", 12);

// Another object is put between.
const between = Object.create(Base.prototype, { done: { set(value) { stored.push("done " + value); }, configurable: true } });
Object.setPrototypeOf(holder.Made.prototype, between);
stored = [];
attempt("an object between", 13);
log.push("stored " + stored.join());
Object.setPrototypeOf(holder.Made.prototype, Base.prototype);
attempt("the link is back", 14);

// Another new.target.
function Stranger() {}
Stranger.prototype.id = "stranger's";
Object.defineProperty(Stranger.prototype, "name", { set(value) { stored.push("stranger " + value); } });
stored = [];
const strange = Reflect.construct(holder.Made, [15, "s", 30], Stranger);
log.push("stranger: " + JSON.stringify(strange) + " " + stored.join() + " " + (strange instanceof Stranger) + " " + (strange instanceof holder.Made));

// The prototype property is replaced.
const first = holder.Made.prototype;
holder.Made.prototype = { set id(value) { stored.push("id " + value); }, get label() { return "new label"; } };
stored = [];
attempt("another prototype object", 16);
log.push("stored " + stored.join());
holder.Made.prototype = first;
attempt("the first prototype object again", 17);

// Called without new.
try {
  holder.Made.call(Object.freeze({}), 1, 2, 3);
  log.push("no throw");
} catch (error) {
  log.push("threw " + error.constructor.name);
}
const borrowed = { id: 0 };
holder.Made.call(borrowed, 18, "b", 36);
log.push("borrowed: " + JSON.stringify(borrowed));
console.log(log.join("\n"));
