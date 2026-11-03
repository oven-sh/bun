// `new holder.Reply(..)`, where nobody knows what the holder holds: the run time makes the object and hands it to the function as `this`. The function stores every field,
// and whoever reads the object afterwards tests it once. The same function is also called on objects that are finished, changed, frozen, or not its own.
const out = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix);
const callUnseen = new Function("callee", "receiver", "a", "b", "return callee.call(receiver, a, b)" + suffix);
function show(name, value) {
  out.push(name + ": " + JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v)));
}

function Reply(raw, log) {
  this.raw = raw;
  this.sent = false;
  this.count = 0;
  this.headers = null;
  this.log = log;
}
Reply.prototype.read = function () {
  return [this.raw, this.sent, this.count, typeof this.count, this.headers, this.log, Object.keys(this).join()];
};
Reply.prototype.change = function () {
  this.count++;
  this.sent = !this.sent;
  return this.count;
};
function read(reply) {
  return [reply.raw, reply.sent, reply.count, typeof reply.count, reply.headers, reply.log, Object.keys(reply).join()];
}

let between = () => {};
function Stepwise(first, second) {
  this.first = first;
  between(this);
  this.second = second;
  this.third = first + second;
}
function readStepwise(object) {
  return [object.first, object.second, object.third, Object.keys(object).join()];
}

function Partly(fill) {
  this.always = 1;
  if (fill) {
    this.sometimes = 2;
    this.number = 3;
  }
}
function readPartly(object) {
  return [object.always, object.sometimes, object.number, typeof object.number, Object.keys(object).join()];
}

function Child(raw, log, extra) {
  Reply.call(this, raw, log);
  this.extra = extra;
}
Object.setPrototypeOf(Child.prototype, Reply.prototype);

const holder = hide({ Reply, Stepwise, Partly, Child });
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (let i = 0; i < 40; i++) read(new holder.Reply(i, "log" + i));
const made = new holder.Reply(1, "a");
show("made by new of a callee that nobody knows", read(made));
show("through its own method", made.read());
show("changed", [made.change(), made.change(), read(made)]);
show("its prototype and constructor", [Object.getPrototypeOf(made) === Reply.prototype, made instanceof Reply, made.constructor === Reply]);
show("made by new of the function itself", read(new Reply(2, "b")));
show("undefined and null as arguments", read(new holder.Reply(undefined, null)));
show("no arguments", read(new holder.Reply()));

const again = new holder.Reply(3, "c");
again.change();
Reply.call(again, 4, "d");
show("called again on a finished object", read(again));
callUnseen(Reply, again, 5, "e");
show("called again by code that nobody sees", read(again));

const withoutField = new holder.Reply(6, "f");
delete withoutField.count;
show("a field deleted", read(withoutField));
Reply.call(withoutField, 7, "g");
show("and the function called on it", read(withoutField));
show("and changed", [withoutField.change(), read(withoutField)]);

const seen = [];
const withAccessor = new holder.Reply(8, "h");
Object.defineProperty(withAccessor, "sent", { get() { return "from the getter"; }, set(v) { seen.push(v); }, enumerable: true, configurable: true });
Reply.call(withAccessor, 9, "i");
show("an accessor in place of a field", [read(withAccessor), seen]);

const readOnly = new holder.Reply(10, "j");
Object.defineProperty(readOnly, "raw", { value: "fixed", writable: false });
show("a field that cannot be written", [attempt(() => Reply.call(readOnly, 11, "k")), read(readOnly)]);

const frozen = Object.freeze(new holder.Reply(12, "l"));
show("a frozen object", [attempt(() => Reply.call(frozen, 13, "m")), read(frozen)]);
const sealed = Object.seal(new holder.Reply(14, "n"));
show("a sealed object", [attempt(() => Reply.call(sealed, 15, "o")), read(sealed)]);

const foreign = hide({ log: "own", other: 1 });
Reply.call(foreign, 16, "p");
show("an object that is not its own", read(foreign));
const bare = Object.create(null);
callUnseen(Reply, bare, 17, "q");
show("an object without a prototype", read(bare));
const ofOtherFunction = new holder.Partly(true);
Reply.call(ofOtherFunction, 18, "r");
show("the object of another function", [read(ofOtherFunction), readPartly(ofOtherFunction)]);

function Other() {}
const forOther = Reflect.construct(holder.Reply, [19, "s"], Other);
show("for another new.target", [read(forOther), forOther instanceof Other, forOther instanceof Reply]);
const bound = hide(Reply.bind(null, 20));
show("through a bound function", read(new bound("t")));

show("nothing happens between the stores", readStepwise(new holder.Stepwise(1, 2)));
between = object => { delete object.first; };
show("the first field is deleted between the stores", readStepwise(new holder.Stepwise(1, 2)));
between = object => { object.third = "early"; object.added = true; };
show("a later field and another name are stored between the stores", readStepwise(new holder.Stepwise(1, 2)));
between = object => { Object.defineProperty(object, "second", { get: () => "getter", set() {}, enumerable: true, configurable: true }); };
show("a later field becomes an accessor between the stores", readStepwise(new holder.Stepwise(1, 2)));
let kept;
between = object => { kept = readStepwise(hide(object)); };
show("the object is read between the stores", [readStepwise(new holder.Stepwise(1, 2)), kept]);
between = object => { Object.freeze(object); };
show("the object is frozen between the stores", attempt(() => readStepwise(new holder.Stepwise(1, 2))));
show("called on a number, on undefined", [attempt(() => Reply.call(5, 1, "x")), attempt(() => Reply.call(undefined, 1, "x")), attempt(() => callUnseen(Reply, null, 1, "x"))]);
between = () => { throw new Error("thrown between the stores"); };
try {
  new holder.Stepwise(1, 2);
} catch (error) {
  show("the function throws between the stores", error.message);
}
between = () => {};
show("nothing happens between the stores, again", readStepwise(new holder.Stepwise(3, 4)));

show("every field stored", readPartly(new holder.Partly(true)));
show("two fields left out", readPartly(new holder.Partly(false)));
for (let i = 0; i < 20; i++) readPartly(new holder.Partly(i % 2 === 0));
show("every field stored, later", readPartly(new holder.Partly(true)));
show("two fields left out, later", readPartly(new holder.Partly(false)));

const child = new holder.Child(21, "u", "extra");
show("a function that calls the first on its own object", [read(child), child.extra, child.read(), child instanceof Reply]);
console.log(out.join("\n"));
