// Constructor functions that the program puts below something else, and what `instanceof` and reads of inherited names find on them, before and after.
const out = [];
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
function ask(label, F, made) {
  let call;
  try {
    call = typeof F.call;
  } catch (error) {
    call = error.constructor.name;
  }
  let answer;
  try {
    answer = made instanceof F;
  } catch (error) {
    answer = error.constructor.name;
  }
  out.push(`${label}: ${answer} ${call}`);
}

function PlainRoot() {}
function PlainLeaf() {}
ask("before the link", PlainLeaf, new PlainLeaf());
Object.setPrototypeOf(PlainLeaf, PlainRoot);
ask("below a function", PlainLeaf, new PlainLeaf());

function LateRoot() {}
function LateLeaf() {}
Object.setPrototypeOf(LateLeaf, LateRoot);
for (let i = 0; i < 3; i++) ask("handler defined late, turn " + i, LateLeaf, new LateLeaf());
Object.defineProperty(LateRoot, Symbol.hasInstance, { value: () => false });
ask("handler defined above", LateLeaf, new LateLeaf());

function KeyRoot() {}
function KeyLeaf() {}
Object.setPrototypeOf(KeyLeaf, KeyRoot);
Object.defineProperty(KeyRoot, passThrough(Symbol.hasInstance), { value: () => false });
Object.defineProperty(KeyRoot, passThrough("call"), { value: 1 });
ask("defined under a key out of sight", KeyLeaf, new KeyLeaf());

function ObjectLeaf() {}
Object.setPrototypeOf(ObjectLeaf, { [Symbol.hasInstance]: () => false, call: 1 });
ask("below a plain object", ObjectLeaf, new ObjectLeaf());

function NullLeaf() {}
const madeBefore = new NullLeaf();
Object.setPrototypeOf(NullLeaf, null);
ask("below nothing", NullLeaf, madeBefore);

function ProxyLeaf() {}
Object.setPrototypeOf(
  ProxyLeaf,
  new Proxy(function () {}, {
    get: (target, key) => (key === Symbol.hasInstance ? () => false : key === "call" ? 1 : target[key]),
  }),
);
ask("below a proxy", ProxyLeaf, new ProxyLeaf());

class WithHandler {
  static [Symbol.hasInstance]() {
    return false;
  }
  static call = 1;
}
function ClassLeaf() {}
Object.setPrototypeOf(ClassLeaf, WithHandler);
ask("below a class with a handler", ClassLeaf, new ClassLeaf());

function ProtoRoot() {}
ProtoRoot.call = 1;
function ProtoLeaf() {}
ProtoLeaf.__proto__ = ProtoRoot;
ask("linked by __proto__", ProtoLeaf, new ProtoLeaf());

function ReflectRoot() {}
function ReflectLeaf() {}
Reflect.setPrototypeOf(ReflectLeaf, ReflectRoot);
ask("linked by Reflect", ReflectLeaf, new ReflectLeaf());
Reflect.defineProperty(ReflectLeaf, Symbol.hasInstance, { value: () => false });
ask("own handler by Reflect", ReflectLeaf, new ReflectLeaf());

function TwiceA() {}
function TwiceB() {}
Object.defineProperty(TwiceB, Symbol.hasInstance, { value: () => false });
function TwiceLeaf() {}
Object.setPrototypeOf(TwiceLeaf, TwiceA);
ask("first link", TwiceLeaf, new TwiceLeaf());
Object.setPrototypeOf(TwiceLeaf, TwiceB);
ask("second link", TwiceLeaf, new TwiceLeaf());

function HiddenRoot() {}
function HiddenLeaf() {}
Object.setPrototypeOf(HiddenLeaf, HiddenRoot);
Object.defineProperty(passThrough(HiddenRoot), Symbol.hasInstance, { value: () => false });
ask("handler defined on a function out of sight", HiddenLeaf, new HiddenLeaf());

function BoundLeaf() {}
Object.setPrototypeOf(BoundLeaf, function () {}.bind(null));
ask("below a bound function", BoundLeaf, new BoundLeaf());

function SelfGuard() {
  if (!(this instanceof SelfGuard)) return new SelfGuard();
  this.made = true;
}
function SelfRoot() {}
Object.setPrototypeOf(SelfGuard, SelfRoot);
out.push(`guard: ${SelfGuard().made} ${new SelfGuard().made}`);
Object.defineProperty(SelfRoot, Symbol.hasInstance, { value: () => true });
out.push(`guard with a handler that says yes: ${SelfGuard.call({ plain: 1 })}`);

// The same asked of each function by its own name.
let seen;
function DirectLateRoot() {}
function DirectLate() {
  seen = this instanceof DirectLate;
}
Object.setPrototypeOf(DirectLate, DirectLateRoot);
for (let i = 0; i < 3; i++) {
  new DirectLate();
  out.push(`direct, handler defined late, turn ${i}: ${seen} ${typeof DirectLate.call}`);
}
Object.defineProperty(DirectLateRoot, Symbol.hasInstance, { value: () => false });
Object.defineProperty(DirectLateRoot, "call", { value: 1 });
new DirectLate();
out.push(`direct, handler defined above: ${seen} ${typeof DirectLate.call}`);

function DirectNull() {
  seen = this instanceof DirectNull;
}
new DirectNull();
out.push(`direct, before nothing: ${seen} ${typeof DirectNull.call}`);
Object.setPrototypeOf(DirectNull, null);
new DirectNull();
out.push(`direct, below nothing: ${seen} ${typeof DirectNull.call}`);

function DirectA() {}
function DirectB() {}
Object.defineProperty(DirectB, Symbol.hasInstance, { value: () => false });
DirectB.call = 1;
function DirectTwice() {
  seen = this instanceof DirectTwice;
}
Object.setPrototypeOf(DirectTwice, DirectA);
new DirectTwice();
out.push(`direct, first link: ${seen} ${typeof DirectTwice.call}`);
Object.setPrototypeOf(DirectTwice, DirectB);
new DirectTwice();
out.push(`direct, second link: ${seen} ${typeof DirectTwice.call}`);

function DirectHiddenRoot() {}
function DirectHidden() {
  seen = this instanceof DirectHidden;
}
Object.setPrototypeOf(DirectHidden, DirectHiddenRoot);
new DirectHidden();
out.push(`direct, before the hidden handler: ${seen}`);
Object.defineProperty(passThrough(DirectHiddenRoot), Symbol.hasInstance, { value: () => false });
new DirectHidden();
out.push(`direct, handler defined out of sight: ${seen}`);

function DirectKeyRoot() {}
function DirectKey() {
  seen = this instanceof DirectKey;
}
Object.setPrototypeOf(DirectKey, DirectKeyRoot);
Object.defineProperty(DirectKeyRoot, passThrough(Symbol.hasInstance), { value: () => false });
new DirectKey();
out.push(`direct, under a key out of sight: ${seen}`);

function DirectObject() {
  seen = this instanceof DirectObject;
}
Object.setPrototypeOf(DirectObject, { [Symbol.hasInstance]: () => false, call: 1 });
new DirectObject();
out.push(`direct, below a plain object: ${seen} ${typeof DirectObject.call}`);

function DirectChainRoot() {}
function DirectChainMiddle() {}
function DirectChain() {
  seen = this instanceof DirectChain;
}
Object.setPrototypeOf(DirectChainMiddle, DirectChainRoot);
Object.setPrototypeOf(DirectChain, DirectChainMiddle);
new DirectChain();
out.push(`direct, below two functions: ${seen} ${typeof DirectChain.call} ${typeof DirectChain.bind}`);
DirectChainRoot.bind = 1;
out.push(`direct, a name stored at the top: ${typeof DirectChain.call} ${typeof DirectChain.bind}`);

console.log(out.join("\n"));
