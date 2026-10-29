// Each function is constructed and looked at in a loop, then something is done to it or to its prototype object in a way of its own, then it is constructed and looked at again.
// What a compiler takes for fixed about a constructor function has to survive every one of these.
const lines = [];
function look(name, make, isInstance) {
  let found = 0;
  let instances = 0;
  for (let i = 0; i < 300; i++) {
    const made = make(i);
    if (made.late !== undefined) found++;
    if (isInstance(made)) instances++;
  }
  lines.push(name + " " + found + " " + instances);
}

function Stored(k) { this.k = k; }
look("stored before", i => new Stored(i), x => x instanceof Stored);
Stored.prototype = { late: 1 };
look("stored after", i => new Stored(i), x => x instanceof Stored);

function Computed(k) { this.k = k; }
look("computed before", i => new Computed(i), x => x instanceof Computed);
Computed["proto" + (lines.length ? "type" : "")] = { late: 1 };
look("computed after", i => new Computed(i), x => x instanceof Computed);

function Assigned(k) { this.k = k; }
look("assigned before", i => new Assigned(i), x => x instanceof Assigned);
Object.assign(Assigned, { prototype: { late: 1 } });
look("assigned after", i => new Assigned(i), x => x instanceof Assigned);

function Defined(k) { this.k = k; }
look("defined before", i => new Defined(i), x => x instanceof Defined);
Object.defineProperty(Defined, "prototype", { value: { late: 1 } });
look("defined after", i => new Defined(i), x => x instanceof Defined);

function Reflected(k) { this.k = k; }
look("reflected before", i => new Reflected(i), x => x instanceof Reflected);
Reflect.set(Reflected, "prototype", { late: 1 });
look("reflected after", i => new Reflected(i), x => x instanceof Reflected);

function Handed(k) { this.k = k; }
function swap(f) { f.prototype = { late: 1 }; }
look("handed before", i => new Handed(i), x => x instanceof Handed);
swap(Handed);
look("handed after", i => new Handed(i), x => x instanceof Handed);

function Relinked(k) { this.k = k; }
look("relinked before", i => new Relinked(i), x => x instanceof Relinked);
Object.setPrototypeOf(Relinked.prototype, { late: 1 });
look("relinked after", i => new Relinked(i), x => x instanceof Relinked);

function RelinkedByName(k) { this.k = k; }
look("relinked by name before", i => new RelinkedByName(i), x => x instanceof RelinkedByName);
RelinkedByName.prototype.__proto__ = { late: 1 };
look("relinked by name after", i => new RelinkedByName(i), x => x instanceof RelinkedByName);

function Named(k) { this.k = k; }
look("named before", i => new Named(i), x => x instanceof Named);
Named.prototype.late = 1;
look("named after", i => new Named(i), x => x instanceof Named);

function Keyed(k) { this.k = k; }
look("keyed before", i => new Keyed(i), x => x instanceof Keyed);
Keyed.prototype["la" + (lines.length ? "te" : "")] = 1;
look("keyed after", i => new Keyed(i), x => x instanceof Keyed);

function ThroughInstance(k) { this.k = k; }
look("through an instance before", i => new ThroughInstance(i), x => x instanceof ThroughInstance);
Object.getPrototypeOf(new ThroughInstance(0)).late = 1;
look("through an instance after", i => new ThroughInstance(i), x => x instanceof ThroughInstance);

function ThroughLink(k) { this.k = k; }
look("through the link before", i => new ThroughLink(i), x => x instanceof ThroughLink);
new ThroughLink(0).__proto__.late = 1;
look("through the link after", i => new ThroughLink(i), x => x instanceof ThroughLink);

function ThroughConstructor(k) { this.k = k; }
look("through constructor before", i => new ThroughConstructor(i), x => x instanceof ThroughConstructor);
new ThroughConstructor(0).constructor.prototype = { late: 1 };
look("through constructor after", i => new ThroughConstructor(i), x => x instanceof ThroughConstructor);

function Getter(k) { this.k = k; }
look("getter before", i => new Getter(i), x => x instanceof Getter);
Object.defineProperty(Getter.prototype, "late", { get() { return this.k + 1; } });
look("getter after", i => new Getter(i), x => x instanceof Getter);

let taken = 0;
function Setter(k) { this.k = k; }
look("setter before", i => new Setter(i), x => x.k !== undefined);
Object.defineProperty(Setter.prototype, "k", { set(value) { taken++; } });
look("setter after", i => new Setter(i), x => x.k !== undefined);
lines.push("taken " + taken);

function Asked(k) { this.k = k; }
look("asked before", i => new Asked(i), x => x instanceof Asked);
Object.defineProperty(Asked, Symbol.hasInstance, { value: () => false });
look("asked after", i => new Asked(i), x => x instanceof Asked);

function AskedAbove(k) { this.k = k; }
look("asked above before", i => new AskedAbove(i), x => x instanceof AskedAbove);
Object.setPrototypeOf(AskedAbove, { [Symbol.hasInstance]: () => false });
look("asked above after", i => new AskedAbove(i), x => x instanceof AskedAbove);

function Number5(k) { this.k = k; }
look("no object before", i => new Number5(i), x => Object.getPrototypeOf(x) === Object.prototype);
Number5.prototype = 5;
look("no object after", i => new Number5(i), x => Object.getPrototypeOf(x) === Object.prototype);

function Untouched(k) { this.k = k; }
look("untouched", i => new Untouched(i), x => x instanceof Untouched);
look("untouched again", i => new Untouched(i), x => x instanceof Untouched && x.constructor === Untouched && Object.getPrototypeOf(Object.getPrototypeOf(x)) === Object.prototype);

console.log(lines.join("\n"));
