"use strict";
// `new F()` where F has neither `this.x =` nor `F.prototype.x =`: what is made, whose prototype it has, what comes back.
const said = [];
const say = (what, answer) => said.push(what + ": " + answer);
const look = o => [typeof o, Object.getPrototypeOf(o) === null ? "null" : Object.getPrototypeOf(o).constructor && Object.getPrototypeOf(o).constructor.name, JSON.stringify(o), Object.keys(o).join()].join(" | ");

function Empty() { }
say("empty", look(new Empty()));
say("empty is an Empty", new Empty() instanceof Empty);
say("two are two", new Empty() !== new Empty());
say("its prototype", Object.getPrototypeOf(new Empty()) === Empty.prototype);
say("called plainly", Empty());

function GivesLiteral(v) { return { v }; }
say("a literal back", look(new GivesLiteral(3)));
say("no GivesLiteral", new GivesLiteral(3) instanceof GivesLiteral);
say("plainly the same", look(GivesLiteral(3)));

function GivesNumber() { return 7; }
say("a number back is dropped", look(new GivesNumber()));
function GivesNull() { return null; }
say("null back is dropped", look(new GivesNull()));
function GivesEither(v) { if (v) return [v]; }
say("either, a list", look(new GivesEither(1)));
say("either, nothing", look(new GivesEither(0)));

function ReadsThis() { return typeof this; }
say("this of a construction", look(new ReadsThis()));
say("this of a call", ReadsThis());
function ReadsAField() { said.push("a field nobody stored: " + this.nothing); }
new ReadsAField();
function ReadsTarget() { said.push("new.target: " + (new.target === ReadsTarget)); }
new ReadsTarget(); ReadsTarget();
function HandsThisOut(sink) { sink.push(this); }
const sink = []; const handed = new HandsThisOut(sink);
say("what was handed out is what came back", sink[0] === handed);
function Throws() { throw new RangeError("no"); }
try { new Throws(); } catch (error) { say("throws", error.message); }

const Held = function () { };
say("held by a constant", look(new Held()));
say("its name", Held.name + " " + new Held().constructor.name);
const Arrow = () => { };
try { new Arrow(); } catch (error) { say("an arrow", error.constructor.name); }

function Grows() { }
const grown = new Grows(); grown.b = 1; grown.a = 2; grown[["c"].join("")] = 3; delete grown.b;
say("fields laid on later", look(grown));
say("frozen", Object.isFrozen(Object.freeze(new Grows())));

function Replaced() { }
const before = new Replaced();
Replaced.prototype = { hello() { return "hello"; } };
const after = new Replaced();
say("before the prototype was replaced", before instanceof Replaced);
say("behind it", after instanceof Replaced && after.hello());
Replaced.prototype = 5;
say("a prototype that is no object", Object.getPrototypeOf(new Replaced()) === Object.prototype);

function Surrogate() { }
function inherit(proto) { Surrogate.prototype = proto; return new Surrogate(); }
say("a surrogate", inherit({ v: 1 }).v + inherit({ v: 2 }).v);

function LaterMethods() { }
const early = new LaterMethods();
LaterMethods[["proto", "type"].join("")].late = function () { return "late"; };
say("a method laid under a computed name", early.late() + " " + new LaterMethods().late());

function Above() { }
class Below extends Above { constructor() { super(); this.w = 1; } }
say("a class below", look(new Below()) + " " + (new Below() instanceof Above));
say("by Reflect.construct", Reflect.construct(Above, [], Below) instanceof Below);
say("by Reflect.construct, of itself", look(Reflect.construct(Above, [])));
function Other() { }
say("another new.target", Reflect.construct(Above, [], Other) instanceof Other);
const bound = Above.bind(null);
say("bound", new bound() instanceof Above);
const proxied = new Proxy(Above, {});
say("through a proxy", new proxied() instanceof Above);

function Nested() { function Inner() { } return new Inner(); }
say("a function of each call", Object.getPrototypeOf(Nested()) !== Object.getPrototypeOf(Nested()));
function WithStatic() { } WithStatic.count = 0; WithStatic.make = function () { WithStatic.count++; return new WithStatic(); };
WithStatic.make(); WithStatic.make();
say("statics", WithStatic.count + " " + look(WithStatic.make()));

let sum = 0;
for (let t = 0; t < 3000; t++) for (let i = 0; i < 16; i++) sum += (new Empty() ? 1 : 0) + new GivesLiteral(i).v + (new GivesEither(i & 1).length | 0);
say("many", sum);
console.log(said.join("\n"));
