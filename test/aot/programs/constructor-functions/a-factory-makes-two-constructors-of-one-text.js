// A factory runs twice: two constructor functions of one text, each with a prototype object of its own.
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

// A second function of the same text, with a prototype object of its own.
const Other = hide(build(Base, []));
attempt("first, after the factory ran again", 2);
log.push("instanceof across: " + (make(3) instanceof Other) + " " + (make(3) instanceof holder.Made) + " " + (make(3) instanceof Base));
const other = new Other(4, "other", 8);
log.push("other: " + JSON.stringify(other) + " " + (other instanceof Other) + " " + (other instanceof holder.Made) + " " + (Object.getPrototypeOf(other) === Other.prototype));
attempt("first, after the second made an object", 5);

Object.defineProperty(Other.prototype, "size", { set(value) { log.push("Other's setter " + value); }, configurable: true });
log.push("other with a setter: " + JSON.stringify(new Other(6, "o", 12)));
attempt("first, while the second has a setter", 7);
console.log(log.join("\n"));
