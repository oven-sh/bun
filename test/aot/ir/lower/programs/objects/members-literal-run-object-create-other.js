// RUN: lower
// OPTIONS: builtin-modules

// The members of a literal store names through `this`. They run on objects made one and two steps below the literal, on the literal, on unrelated objects and on primitives,
// while the objects above gain, lose and redefine members.
const lines = [];
const answers = {
  get sent() {
    return this.res.sent;
  },
  has(name) {
    return this.res.names === name;
  },
  get status() {
    return this.res.code;
  },
  set status(code) {
    if (this.sent) return;
    this._explicitStatus = true;
    this.res.code = code;
  },
  get body() {
    return this._body;
  },
  set body(value) {
    const original = this._body;
    this._body = value;
    if (!this._explicitStatus) this.status = 200;
    if (!this.has("b")) this.length = value.length;
    if (original !== undefined) this.replaced = (this.replaced | 0) + 1;
  },
  set length(n) {
    this.res.size = n;
  },
  get length() {
    return this.res.size;
  },
  describe() {
    return Object.keys(this).join() + "|" + this._body + "|" + this._explicitStatus + "|" + this.replaced;
  },
  whatIsThis() {
    "use strict";
    return typeof this;
  },
};
class Application {
  constructor() {
    this.answers = Object.create(answers);
  }
  create(req, res) {
    const made = Object.create(this.answers);
    made.app = this;
    made.req = req;
    made.res = res;
    return made;
  }
}
const hidden = process.argv.length > 9 ? "x" : "";
const application = new Application();
const newRes = () => ({ sent: false, names: "a", code: 404, size: 0 });
function handle(answer, value) {
  answer.body = value;
  return answer.status + ":" + answer.length + ":" + answer.describe();
}
globalThis["handle" + hidden] = handle;
function call(answer, value) {
  try {
    return globalThis["handle" + hidden](answer, value);
  } catch (error) {
    return "threw " + error.constructor.name + " " + answers.describe.call(answer);
  }
}

for (let i = 0; i < 3; i++) lines.push(call(application.create({ url: "/" }, newRes()), "Hello" + "!".repeat(i)));

const twice = application.create({}, newRes());
lines.push(call(twice, "one"), call(twice, "three"), Object.getOwnPropertyNames(twice).join());

// The order of the names is the order of the stores.
const ordered = application.create({}, newRes());
ordered.replaced = 7;
ordered._explicitStatus = false;
lines.push(call(ordered, "x"), JSON.stringify(Object.entries(ordered).map(([name]) => name)));

// One step below, the literal itself, an unrelated object, a primitive.
application.answers.res = newRes();
lines.push(call(application.answers, "middle"), Object.keys(application.answers).join());
delete application.answers.res;
delete application.answers._body;
delete application.answers._explicitStatus;
answers.res = newRes();
lines.push(call(answers, "top"), Object.keys(answers).length);
delete answers.res;
delete answers._body;
delete answers._explicitStatus;
const stranger = { res: newRes(), has: answers.has, describe: answers.describe };
Object.defineProperty(stranger, "body", Object.getOwnPropertyDescriptor(answers, "body"));
lines.push(call(stranger, "far"), stranger.status, stranger.length);
lines.push(answers.whatIsThis.call(5), answers.whatIsThis.call(undefined), answers.whatIsThis.call("s"), answers.describe.call([1, 2]));
try {
  Object.getOwnPropertyDescriptor(answers, "body").set.call(undefined, "x");
} catch (error) {
  lines.push(error instanceof TypeError);
}

// A name that the members store gets an accessor above, then a value, then goes.
const seen = [];
Object.defineProperty(application.answers, "_body", {
  get() {
    return "from above";
  },
  set(value) {
    seen.push(value);
  },
  configurable: true,
});
const below = application.create({}, newRes());
lines.push(call(below, "caught"), seen.join(), Object.hasOwn(below, "_body"));
Object.defineProperty(application.answers, "_body", { value: "fixed", writable: false, configurable: true });
const refused = application.create({}, newRes());
lines.push(call(refused, "dropped"), Object.hasOwn(refused, "_body"));
delete application.answers._body;
lines.push(call(application.create({}, newRes()), "again"));

// An accessor of the literal becomes a value, a method is replaced, the link above changes.
Object.defineProperty(answers, "status", { value: 599, writable: true, configurable: true });
const plain = application.create({}, newRes());
lines.push(call(plain, "value"), Object.hasOwn(plain, "status"), plain.res.code);
answers.has = () => true;
lines.push(call(application.create({}, newRes()), "no length"));
Object.setPrototypeOf(application.answers, { describe: () => "other", set body(value) {}, status: 1, length: 2 });
lines.push(call(application.create({}, newRes()), "elsewhere"));

// Frozen, sealed and closed objects.
Object.setPrototypeOf(application.answers, answers);
delete answers.status;
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
  const closed = close(application.create({}, newRes()));
  lines.push(call(closed, "closed"), Object.keys(closed).join());
}
console.log(lines.join("\n"));

// GENERATED: Application create status whatIsThis newRes
// CHECK-LABEL: function {{*}}name="Application"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="answers"
// CHECK-NEXT: v9 = Call v6, v5, v8 calleeName="Object.create"
// CHECK-NEXT: PropSet v4, v9 key="answers"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="create"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="answers"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v4, v3, v7 calleeName="Object.create"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v9, v10 key="app"
// CHECK-NEXT: PropSet v9, v1 key="req"
// CHECK-NEXT: PropSet v9, v2 key="res"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="status"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="res"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="code"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="status"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="sent"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: PropSet v8, v9 key="_explicitStatus"
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="res"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v13, v1 key="code"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="whatIsThis"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="newRes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_10]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
