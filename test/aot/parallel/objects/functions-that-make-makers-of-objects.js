// A function that is called at the top level of a module makes a prototype object and a function that makes objects below it. Each call has a prototype object of its own,
// and the program changes those objects, the objects below them and the makers in every way it can.
const args = "~lib/args", evaluate = "~lib/evaluate", cont = "~lib/cont";
const lines = [];
const attempt = action => { try { return action(); } catch (error) { return error.constructor.name; } };
const say = (...parts) => lines.push(parts.map(part => (typeof part === "symbol" ? part.toString() : String(part))).join(" "));

const Base = { pipe() { return "pipe:" + this[args]; }, toString() { return "made(" + String(this[args]) + ")"; } };
const makeMembers = options => ({ ...Base, op: options.op, [evaluate]: options[evaluate] ?? function () { return "default"; }, [cont]: options[cont] });
const makePrimitive = options => {
  const members = makeMembers(options);
  return function (value) {
    const self = Object.create(members);
    self[args] = options.single === false ? arguments : value;
    return self;
  };
};
function makeDeclared(options) {
  const members = { op: options.op, read() { return this.held; } };
  return value => { const self = Object.create(members); self.held = value; return self; };
}

const succeed = makePrimitive({ op: "Success", [evaluate](by) { return this[args] + by; } });
const fail = makePrimitive({ op: "Failure", [evaluate](by) { return this[args] - by; } });
const sync = makePrimitive({ op: "Sync", [evaluate](by) { return this[args]() + by; } });
const both = makePrimitive({ op: "Both", single: false, [evaluate](by) { return this[args][0] + this[args][1] + by; } });
const plain = makePrimitive({ op: "Plain" });
const first = makeDeclared({ op: "first" }), second = makeDeclared({ op: "second" });
const inLoop = [];
for (let index = 0; index < 3; index++) inLoop.push(makePrimitive({ op: "loop" + index, [evaluate](by) { return index * 100 + this[args] + by; } }));
const passed = [{ op: "a" }, { op: "b" }].map(makePrimitive);
const held = { make: makePrimitive };
const throughMember = held.make({ op: "member", [evaluate]() { return "member:" + this[args]; } });

function run(effect, by) { return effect[evaluate](by); }
function sum(count) {
  let total = 0;
  const one = () => 1;
  for (let index = 0; index < count; index++) {
    const effect = (index & 3) === 0 ? succeed(index & 7) : (index & 3) === 1 ? fail(index & 7) : (index & 3) === 2 ? sync(one) : both(1, 2);
    total += run(effect, 1);
  }
  return total;
}

say("sum", sum(4000));
say("default", run(plain(1), 1), plain(2).op, String(plain(3)), plain(4).pipe());
say("loop", inLoop.map((make, index) => run(make(index), 1)).join());
say("passed", passed.map(make => make(5).op + ":" + run(make(5), 0)).join());
say("member", run(throughMember(6), 0));
say("declared", first(1).read(), second(2).read(), first(1).op, second(2).op);

// Who is who.
say("makers differ", succeed !== fail, succeed.name === fail.name, succeed.length, String(succeed) === String(fail), makePrimitive.name, makePrimitive.length);
say("prototypes", Object.getPrototypeOf(succeed(1)) === Object.getPrototypeOf(succeed(2)), Object.getPrototypeOf(succeed(1)) === Object.getPrototypeOf(fail(1)));
say("keys", Object.keys(succeed(1)).join(), JSON.stringify(succeed(1)), Reflect.ownKeys(both(1, 2)).join(), both(1, 2)[args].length);
say("in", args in succeed(1), evaluate in succeed(1), Object.hasOwn(succeed(1), evaluate), "op" in fail(1));
say("is prototype", Object.getPrototypeOf(fail(0)).isPrototypeOf(fail(1)), Object.getPrototypeOf(fail(0)).isPrototypeOf(succeed(1)));

// A setter under the name that the maker stores, on one prototype object alone.
const membersOfFail = Object.getPrototypeOf(fail(0));
let caught = [];
Object.defineProperty(membersOfFail, args, { set(value) { caught.push(value); }, get() { return 40; }, configurable: true });
say("setter", Object.keys(fail(7)).length, run(fail(7), 1), caught.join(), Object.keys(succeed(7)).length, run(succeed(7), 1));
say("sum with a setter", sum(400));
delete membersOfFail[args];
say("setter gone", Object.keys(fail(7)).join(), run(fail(7), 1), sum(400));

// A name that cannot be written.
const membersOfSync = Object.getPrototypeOf(sync(0));
Object.defineProperty(membersOfSync, args, { value: () => 9, writable: false, configurable: true });
say("read-only above", attempt(() => Object.keys(sync(() => 1)).length), attempt(() => run(sync(() => 1), 1)), attempt(() => sum(400)));
delete membersOfSync[args];
say("writable again", run(sync(() => 1), 1));

// The method is replaced, removed, found higher up.
const membersOfSucceed = Object.getPrototypeOf(succeed(0));
const before = membersOfSucceed[evaluate];
membersOfSucceed[evaluate] = function (by) { return "replaced:" + (this[args] + by); };
say("replaced", run(succeed(1), 1), run(fail(1), 1));
delete membersOfSucceed[evaluate];
try { run(succeed(1), 1); say("no error"); } catch (error) { say("removed", error instanceof TypeError); }
Object.setPrototypeOf(membersOfSucceed, { [evaluate](by) { return "above:" + (this[args] + by); } });
say("above", run(succeed(1), 1), typeof succeed(1).hasOwnProperty);
Object.setPrototypeOf(membersOfSucceed, Object.prototype);
membersOfSucceed[evaluate] = before;
say("back", run(succeed(1), 1), sum(400));

// The objects themselves.
const moved = succeed(3);
Object.setPrototypeOf(moved, membersOfFail);
say("moved", run(moved, 1), moved.op);
Object.setPrototypeOf(moved, null);
say("bare", moved[args], moved[evaluate], Object.getPrototypeOf(moved));
const frozen = Object.freeze(fail(3));
say("frozen", attempt(() => { frozen[args] = 9; }), attempt(() => { frozen.more = 1; }), run(frozen, 1), Object.isFrozen(frozen), "more" in frozen);
const emptied = succeed(4);
say("deleted", delete emptied[args], run(emptied, 1), Object.keys(emptied).length);
emptied[args] = 5; emptied.extra = 1;
say("stored again", run(emptied, 1), Object.keys(emptied).join());
const accessor = succeed(5);
Object.defineProperty(accessor, args, { get() { return 50; }, enumerable: false, configurable: true });
say("own getter", run(accessor, 1), Object.keys(accessor).length);

// A prototype object that cannot be extended or is frozen still has objects below it.
Object.freeze(Object.getPrototypeOf(plain(0)));
say("frozen above", run(plain(1), 1), plain(2)[args], Object.keys(plain(3)).join());

// A Proxy, null and a primitive where the prototype object stands.
const makeBelow = members => value => { const self = Object.create(members); self.held = value; return self; };
const seen = [];
const belowProxy = makeBelow(new Proxy({ read() { return this.held; } }, { set(target, key, value, receiver) { seen.push(String(key)); return Reflect.set(target, key, value, receiver); }, get(target, key, receiver) { seen.push("get " + String(key)); return Reflect.get(target, key, receiver); } }));
say("proxy", belowProxy(1).read(), seen.join());
const belowNull = makeBelow(null);
say("null", belowNull(2).held, Object.getPrototypeOf(belowNull(2)), Object.keys(belowNull(2)).join());
const belowNumber = makeBelow(3);
try { belowNumber(1); say("no error"); } catch (error) { say("primitive", error instanceof TypeError); }
const belowFunction = makeBelow(function named() {});
say("function", belowFunction(4).held, belowFunction(4).name, typeof belowFunction(4));
const belowArray = makeBelow([1, 2, 3]);
say("array", belowArray(5).held, belowArray(5).length, Array.isArray(belowArray(5)));

// A maker that can tell which closure was called, one that calls itself, one that is constructed.
const makeSloppy = new Function("return function (members) { const callee = arguments.callee; return value => { const self = Object.create(members); self.same = callee; self.held = value; return self; }; }")();
const makeSloppyUnused = function (members) { const callee = makeSloppy; return value => { const self = Object.create(members); self.same = callee === makeSloppy; self.held = value; return self; }; };
say("callee", makeSloppy({ a: 1 })(1).same === makeSloppy, makeSloppy({ a: 2 })(1).a, makeSloppyUnused({ a: 3 })(1).same);
const makeNamed = function self(members, depth) { if (depth) return self(Object.create(members), depth - 1); return value => { const made = Object.create(members); made.same = self === makeNamed; made.held = value; return made; }; };
const deep = makeNamed({ a: 1 }, 2)(7);
say("named", deep.same, deep.a, deep.held, Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(deep))).a);
function MakeConstructed(members) { this.make = value => { const self = Object.create(members); self.owner = this; self.held = value; return self; }; }
const constructed = new MakeConstructed({ a: 3 });
say("constructed", constructed.make(1).a, constructed.make(1).owner === constructed);

// Makers that also define a class or a constructor function, each call its own.
const makeWithClass = members => {
  class Holder { constructor(value) { this.value = value; } read() { return this.value; } static made = 0; }
  function Old(value) { this.old = value; }
  Old.prototype.read = function () { return this.old; };
  return value => { const self = Object.create(members); self.holder = new Holder(value); self.old = new Old(value); self.Holder = Holder; self.Old = Old; Holder.made++; return self; };
};
const withClassA = makeWithClass({ a: 1 }), withClassB = makeWithClass({ a: 2 });
const classA = withClassA(1), classA2 = withClassA(2), classB = withClassB(3);
say("classes", classA.holder.read(), classB.holder.read(), classA.old.read(), classB.old.read(), classA.Holder === classA2.Holder, classA.Holder === classB.Holder, classA.Old === classB.Old);
say("instances", classA.holder instanceof classA2.Holder, classA.holder instanceof classB.Holder, classB.old instanceof classA.Old, classA.Holder.made, classB.Holder.made);

// A maker that is called before it exists.
try { early({}); say("no error"); } catch (error) { say("early", error instanceof ReferenceError); }
const early = members => () => Object.create(members);

// Where an error says it was thrown.
const thrower = makePrimitive({ op: "Throw", [evaluate]() { throw new Error("thrown:" + this[args]); } });
try { run(thrower(1), 0); } catch (error) { say("thrown", error.message, /functions-that-make-makers/.test(error.stack)); }
const broken = makePrimitive(null === undefined ? {} : { op: "ok" });
try { makePrimitive(undefined); say("no error"); } catch (error) { say("bad options", error instanceof TypeError, /makeMembers/.test(error.stack), /makePrimitive/.test(error.stack)); }
say("ok", broken(1).op);

console.log(lines.join("\n"));
