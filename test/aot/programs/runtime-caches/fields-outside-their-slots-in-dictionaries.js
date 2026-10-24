// A field outside its slot, read by name at one hot site, while the extra properties become a dictionary, lose and regain names, and the object is a prototype.
function make(i) { return { a: i, b: i + 1, c: i + 2 }; }
function readB(o) { return o.b; }
function hot(...objects) {
  let total = 0;
  for (let round = 0; round < 300; round++) {
    for (const o of objects) {
      const value = readB(o);
      total += typeof value === "number" ? value : String(value).length;
    }
  }
  return total;
}
const lines = [];
function show(label, ...values) { lines.push(label + ": " + values.join(" ")); }

const o = make(1);
Object.defineProperty(o, "b", { enumerable: false });
show("hidden", hot(o));
for (let i = 0; i < 100; i++) o["k" + i] = i;
show("beside a hundred names", hot(o), Object.keys(o).length);
delete o.k3; delete o.k4;
show("after deletions", hot(o), Object.keys(o).length);
delete o.b;
show("deleted from the dictionary", hot(o), "b" in o, Object.hasOwn(o, "b"));
o.z1 = "takes a free offset"; o.z2 = "and another";
show("names in its place", hot(o), "b" in o);
o.b = 77;
show("created again", hot(o), Object.keys(o).includes("b"));
Object.defineProperty(o, "b", { get() { return this.a + 4; }, configurable: true });
show("getter", hot(o));
Object.defineProperty(o, "b", { value: "text", writable: true, enumerable: true, configurable: true });
show("text", hot(o));
o.b = 6;
show("number", hot(o));

const p = make(10), q = make(20);
for (const each of [p, q]) Object.defineProperty(each, "b", { enumerable: false });
show("two hidden", hot(p, q));
p.b = 3;
show("one stored", hot(p, q));
Object.defineProperty(p, "b", { enumerable: true });
show("one back in its slot", hot(p, q), Object.keys(p).join(), Object.keys(q).join());
delete q.b;
show("the other deleted", hot(p, q), hot(q));
const above = { other: 1 };
Object.setPrototypeOf(q, above);
show("another prototype", hot(q));
above.b = 1000;
show("found above", hot(p, q), hot(q));
delete above.b;
show("gone above", hot(q));

const holder = make(30);
Object.defineProperty(holder, "b", { value: 8, writable: true, enumerable: false, configurable: true });
const child = Object.create(holder);
show("inherited", hot(child), hot(holder));
holder.b = 9;
show("inherited after a store", hot(child));
Object.defineProperty(holder, "b", { enumerable: true });
show("inherited from the slot", hot(child), hot(holder));
Object.defineProperty(holder, "b", { get() { return this === child ? 1 : 2; }, configurable: true });
show("inherited getter", hot(child), hot(holder));
try { child.b = 5; } catch (error) { show("store throws", error.constructor.name); }
show("store through the getter", hot(child), Object.hasOwn(child, "b"));

const frozen = make(40);
Object.defineProperty(frozen, "b", { enumerable: false });
Object.freeze(frozen);
try { frozen.b = 1; } catch (error) { show("store throws", error.constructor.name); }
show("frozen", hot(frozen), Object.isFrozen(frozen));
console.log(lines.join("\n"));
