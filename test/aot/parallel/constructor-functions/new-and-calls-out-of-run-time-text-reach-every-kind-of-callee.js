// Text made at run time constructs functions of the program, and the program calls and constructs what the text made: every kind of callee, with new.target the function itself and another one.
const nothing = String(Date.now()).slice(99);
const text = (parameters, body) => new Function(...parameters, body + nothing);
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return `${error.constructor.name}: ${error.message.split(" (In ")[0]}`;
  }
};
const show = value => {
  if (value === null || typeof value !== "object") return String(value);
  const prototype = Object.getPrototypeOf(value);
  const name = prototype === null ? "null" : prototype.constructor?.name;
  return `${name} ${JSON.stringify(value)}`;
};

const construct = text(["F", "values"], "const o = new F(); o['a'] = values[0]; o.b = values[1]; return o;");
const constructWith = text(["F", "G"], "return Reflect.construct(F, [1, 2], G);");
const callIt = text(["f", "x"], "return f(x);");

const NullObject = function () {};
NullObject.prototype = Object.create(null);
function ReadsTarget() {
  this.target = new.target === ReadsTarget ? "own" : new.target?.name;
}
function Fields(a, b) {
  this.a = a;
  this.b = b;
}
function ReturnsObject() {
  return { made: true };
}
function ReturnsNumber() {
  this.kept = true;
  return 5;
}
function Throws() {
  throw new RangeError("from the constructor");
}
class Plain {
  own = 1;
}
class Derived extends Plain {
  constructor() {
    super();
    this.second = new.target.name;
  }
}
const arrow = () => 1;
function WithProperty() {
  this.seen = WithProperty.mark;
}
WithProperty.mark = "marked";
function Late() {
  this.late = true;
}
const lateTwin = Late;
const bound = Fields.bind(null, "bound");
const proxied = new Proxy(Fields, {});
const trapped = new Proxy(Fields, {
  construct(target, args) {
    return { trapped: args.length };
  },
});

for (const F of [NullObject, ReadsTarget, Fields, ReturnsObject, ReturnsNumber, Throws, Plain, Derived, arrow, WithProperty, Late, bound, proxied, trapped, Object, Array, Map, Date.now, 5, undefined, {}]) {
  const name = typeof F === "function" ? F.name : String(F);
  // Twice: the second time the remembered structure of the function is there.
  for (let turn = 0; turn < 2; turn++) {
    const made = attempt(() => (F === Map ? construct(F, []).constructor.name : show(construct(F, ["x", turn]))));
    console.log("new", name, made);
  }
}

Late.prototype = { replaced: true };
console.log(show(construct(lateTwin, [1, 2])), Object.getPrototypeOf(construct(lateTwin, [1, 2])).replaced);

for (const [F, G] of [
  [Fields, Fields],
  [Fields, ReadsTarget],
  [ReadsTarget, Fields],
  [ReadsTarget, Plain],
  [Plain, Fields],
  [Derived, Fields],
  [NullObject, Object],
  [Object, Fields],
  [Fields, bound],
  [Fields, arrow],
]) {
  console.log("target", F.name, G.name, attempt(() => show(constructWith(F, G))));
  console.log("target", F.name, G.name, attempt(() => show(constructWith(F, G))));
}

const fromText = [
  text(["x"], "return x + 1;"),
  text(["x"], "'use strict'; return this === undefined ? x : -x;"),
  text(["x"], "return arguments.length;"),
  text([], "return arguments.length;"),
  text(["a", "b", "c", "d", "e", "f"], "return [a, b, c, d, e, f].join();"),
  text(["x"], "throw new TypeError('from the text ' + x);"),
  text(["x"], "return new.target === undefined;"),
];
const withRareData = text(["x"], "return x * 2;");
withRareData.note = "rare";
withRareData.prototype;
const boundText = fromText[0].bind(null, 40);
const proxiedText = new Proxy(fromText[0], {});
const callables = [...fromText, withRareData, boundText, proxiedText, String, Number, Math.abs, parseInt, arrow, Fields, Plain, class {}, {}, null, undefined, 1, "text", Symbol.iterator, new Proxy({}, {}), new Proxy(() => 2, {})];

function calledOnce(callee) {
  return callee(20);
}
function calledInLoop(callee, turns) {
  let last;
  for (let i = 0; i < turns; i++) last = callee(i);
  return last;
}
function calledWithSix(callee) {
  return callee(1, 2, 3, 4, 5, 6);
}
function calledWithNone(callee) {
  return callee();
}
function tail(callee, x) {
  return callee(x);
}
for (const callee of callables) {
  const name = typeof callee === "function" ? callee.name || "anonymous" : String(typeof callee);
  console.log(name, attempt(() => show(calledOnce(callee))), attempt(() => show(calledInLoop(callee, 3))), attempt(() => show(calledWithSix(callee))), attempt(() => show(calledWithNone(callee))), attempt(() => show(tail(callee, 7))), attempt(() => show(callIt(callee, 8))));
}

const counted = text(["depth"], "return depth === 0 ? 0 : 1 + this.next(depth - 1);");
const holder = { next: counted };
console.log(holder.next(50));
console.log(new (text([], "this.made = 1;"))().made, attempt(() => new (text([], "return 1;"))()) instanceof Object);
