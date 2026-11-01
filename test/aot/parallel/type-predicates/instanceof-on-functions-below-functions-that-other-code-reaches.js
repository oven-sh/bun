// `Object.setPrototypeOf(Leaf, Middle)`: the function stands below another one, and code that nobody compiled ahead of time reaches all of them.
// Each change comes after the test has run often: Symbol.hasInstance appears above, goes, a parent changes, the prototype property changes.
function Root() {
  if (!(this instanceof Root)) return new Root();
  this.root = 1;
}
function Middle() {
  if (!(this instanceof Middle)) return new Middle();
  Root.call(this);
  this.middle = 2;
}
function Leaf() {
  if (!(this instanceof Leaf)) return new Leaf();
  Middle.call(this);
  this.leaf = 3;
}
for (const [below, above] of [
  [Middle, Root],
  [Leaf, Middle],
]) {
  below.prototype = Object.create(above.prototype, {
    constructor: { value: below, writable: true, configurable: true },
  });
  Object.setPrototypeOf(below, above);
}

const hidden = new Function("functions", "globalThis.reached = functions; return name => globalThis.reached[name];")({
  Root,
  Middle,
  Leaf,
});

function ask(value) {
  return [value instanceof Leaf, value instanceof Middle, value instanceof Root].map(Number).join("");
}
function warm() {
  let text = "";
  for (let i = 0; i < 300; i++) text = ask(new Leaf()) + ask(new Middle()) + ask(new Root()) + ask({}) + ask(Leaf());
  return text;
}
const say = label => console.log(label, warm());

say("as written");

let calls = 0;
const answer = value => ({
  value(object) {
    calls++;
    return value && object != null;
  },
  configurable: true,
});
Object.defineProperty(hidden("Root"), Symbol.hasInstance, answer(true));
say("the top says yes");
console.log(calls > 0);
delete hidden("Root")[Symbol.hasInstance];
say("the top says nothing again");

Object.defineProperty(hidden("Middle"), Symbol.hasInstance, answer(true));
say("the middle says yes");
delete hidden("Middle")[Symbol.hasInstance];
say("the middle says nothing again");

Object.defineProperty(hidden("Leaf"), Symbol.hasInstance, answer(true));
say("the leaf says yes");
delete hidden("Leaf")[Symbol.hasInstance];
say("the leaf says nothing again");

function Other() {}
Object.defineProperty(Other, Symbol.hasInstance, answer(true));
Object.setPrototypeOf(hidden("Leaf"), Other);
say("the leaf stands below another function that says yes");
Object.setPrototypeOf(hidden("Leaf"), hidden("Middle"));
say("the leaf is back");

Object.setPrototypeOf(hidden("Middle"), Other);
say("the middle stands below it");
Object.setPrototypeOf(hidden("Middle"), hidden("Root"));
say("the middle is back");

Object.setPrototypeOf(hidden("Root"), Other);
say("the top stands below it");
Object.setPrototypeOf(hidden("Root"), Function.prototype);
say("the top is back");

Object.setPrototypeOf(hidden("Leaf"), null);
say("the leaf has no parent");
Object.setPrototypeOf(hidden("Leaf"), hidden("Middle"));

const between = Object.create(hidden("Root"));
Object.setPrototypeOf(hidden("Middle"), between);
say("an ordinary object stands between");
Object.defineProperty(between, Symbol.hasInstance, answer(true));
say("and says yes");
delete between[Symbol.hasInstance];
say("and says nothing again");
Object.setPrototypeOf(hidden("Middle"), hidden("Root"));

let asked = 0;
const proxy = new Proxy(hidden("Root"), {
  get(target, key, receiver) {
    if (key === Symbol.hasInstance) asked++;
    return Reflect.get(target, key, receiver);
  },
});
Object.setPrototypeOf(hidden("Middle"), proxy);
say("a proxy stands between");
console.log(asked > 0);
Object.setPrototypeOf(hidden("Middle"), hidden("Root"));
say("the proxy is gone");

const old = new Leaf();
const kept = hidden("Middle").prototype;
hidden("Middle").prototype = {};
console.log("the middle has another prototype property", ask(old), ask(new Leaf()));
hidden("Middle").prototype = kept;
console.log("and its own again", ask(old), ask(new Leaf()));

Object.setPrototypeOf(hidden("Leaf").prototype, hidden("Root").prototype);
console.log("the prototype object of the leaf skips the middle", ask(old), ask(new Leaf()));
Object.setPrototypeOf(hidden("Leaf").prototype, kept);
console.log("and stands below it again", ask(old), ask(new Leaf()));

Object.setPrototypeOf(old, hidden("Root").prototype);
console.log("one object moved", ask(old), ask(new Leaf()));
