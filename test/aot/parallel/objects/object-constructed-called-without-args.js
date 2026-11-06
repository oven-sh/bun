// Object constructed or called without arguments makes what an empty literal makes.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));

function describe(made) {
  return [
    Object.getPrototypeOf(made) === Object.prototype,
    made.constructor === Object,
    made instanceof Object,
    Object.keys(made).join(),
    JSON.stringify(made),
    Object.isExtensible(made),
    Object.prototype.toString.call(made),
  ].join(" ");
}

say("constructed", describe(new Object()));
say("constructed without a list", describe(new Object));
say("called", describe(Object()));
say("each is new", new Object() !== new Object(), Object() !== Object());

const filled = new Object();
filled.first = 1;
filled["second"] = "two";
filled[3] = true;
filled[Symbol.for("fourth")] = 4;
say("filled", describe(filled), Reflect.ownKeys(filled).map(String).join());
delete filled.first;
say("emptied", describe(filled));

const called = Object();
Object.defineProperty(called, "hidden", { value: 1 });
Object.defineProperty(called, "twice", { get() { return this.hidden * 2; }, enumerable: true });
say("defined", describe(called), called.twice);
say("frozen", Object.isFrozen(Object.freeze(new Object())));

const kept = [];
for (let i = 0; i < 5; i++) {
  const made = i & 1 ? new Object() : Object();
  made.index = i;
  if (i > 2) made.late = true;
  kept.push(made);
}
say("kept", JSON.stringify(kept));

say("with an argument", new Object(1) instanceof Number, typeof Object("text"), Object(filled) === filled, new Object(filled) === filled);
say("with nothing for an argument", describe(new Object(undefined)), describe(Object(null)));
say("with a list", describe(new Object(...[])), new Object(...[filled]) === filled);
say("asked whether it is there", describe(Object?.()));

function shadowedByAParameter(Object) {
  return [new Object().mark, Object().mark].join();
}
say("another function under the name", shadowedByAParameter(function () { return { mark: "mine" }; }));
{
  class Object {
    mark = "a class of the program";
  }
  say("a class under the name", new Object().mark);
}

class Below extends Object {
  stamp = 7;
}
say("a class below", new Below().stamp, new Below() instanceof Below, Reflect.construct(Object, [], Below) instanceof Below);

const above = new Object();
above.inherited = "from above";
say("as a prototype", Object.create(above).inherited, Object.setPrototypeOf(new Object(), above).inherited);

console.log(lines.join("\n"));
