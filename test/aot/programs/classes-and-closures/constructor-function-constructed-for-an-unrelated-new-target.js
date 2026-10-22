// Reflect.construct runs a constructor function for a new.target that is not below it: another constructor function (one that is never constructed itself, one that is), a class, a bound function, a Proxy, a native constructor. The object inherits from the prototype of new.target, gets the fields the function stores, and is an instance of new.target alone
function Target(seed) { this.seed = seed; this.read = () => this.seed; }
Target.prototype.kind = "target";
Target.prototype.twice = function () { return this.seed * 2; };

function NeverConstructed() {}
NeverConstructed.prototype.kind = "never constructed";

function AlsoConstructed(seed) { this.own = seed; }
AlsoConstructed.prototype.kind = "also constructed";
AlsoConstructed.prototype.sum = function () { return (this.own ?? 0) + (this.seed ?? 0); };

class Stranger { #secret = 5; field = 6; kind() { return "stranger"; } secret() { return this.#secret; } }
class Below extends Target { constructor(seed) { super(seed); this.below = seed + 1; } }

const bound = AlsoConstructed.bind(null, 7);
const proxy = new Proxy(NeverConstructed, {});

function attempt(run) { try { return run(); } catch (error) { return error.name; } }
function describe(label, made) {
  const kind = typeof made.kind === "function" ? made.kind() : made.kind;
  console.log(label, made.seed, made.read(), kind, Object.keys(made).join(), made instanceof Target, typeof made.twice, attempt(() => made.secret()), made.field, made.below, made.own);
}

for (let round = 0; round < 3; round++) {
  describe("itself", new Target(round));
  describe("itself, two operands", Reflect.construct(Target, [round]));
  describe("itself, three operands", Reflect.construct(Target, [round], Target));
  describe("never constructed", Reflect.construct(Target, [round], NeverConstructed));
  const mixed = Reflect.construct(Target, [round], AlsoConstructed);
  describe("also constructed", mixed);
  console.log(mixed.sum(), new AlsoConstructed(round).sum(), mixed instanceof AlsoConstructed, new AlsoConstructed(round) instanceof AlsoConstructed);
  describe("class", Reflect.construct(Target, [round], Stranger));
  console.log(new Stranger().secret(), new Stranger().field);
  describe("class below", Reflect.construct(Target, [round], Below));
  describe("constructed below", new Below(round));
  describe("bound function", Reflect.construct(Target, [round], bound));
  describe("proxy", Reflect.construct(Target, [round], proxy));
  describe("Object", Reflect.construct(Target, [round], Object));
  const list = Reflect.construct(Target, [round], Array);
  console.log("Array", list.seed, list.read(), Array.isArray(list), list instanceof Array, list.length, Object.keys(list).join());
  const map = Reflect.construct(Target, [round], Map);
  console.log("Map", map.seed, map instanceof Map, attempt(() => map.size));
  console.log("no constructor", attempt(() => Reflect.construct(Target, [round], () => {})), attempt(() => Reflect.construct(Target, [round], 5)));
}

const kept = [];
for (let i = 0; i < 300; i++) kept.push(i % 3 ? Reflect.construct(Target, [i], i % 3 === 1 ? NeverConstructed : AlsoConstructed) : new Target(i));
let sum = 0;
for (let k = 0; k < kept.length; k++) sum += kept[k].read() + kept[k].kind.length;
console.log(sum);
