// A host object has its own put and the ordinary defineOwnProperty. Class fields define one name twice on it, by name and by key, which calls no put. Every store after that still calls the host's put, however often the definitions and the stores have run.
// Env: JSC_useDollarVM=1
const turns = JSON.parse("40");
const key = JSON.parse('"y"');
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }

// Its put stores String(value). Only the jsc shell has $vm. Elsewhere a proxy that has a trap for stores and none for definitions stands in for the host object.
const storesText = { set(target, name, value) { return Reflect.defineProperty(target, name, { value: String(value), writable: true, enumerable: true, configurable: true }); } };
function Host() { return typeof $vm === "object" ? $vm.createObjectDoingSideEffectPutWithoutCorrectSlotStatus() : new Proxy({}, storesText); }
class DefinedOnce extends Host { x = 1; [key] = 1; }
class DefinedTwice extends DefinedOnce { x = 2; [key] = 2; }

function describe(o) { return typeof o.x + " " + o.x + " " + typeof o[key] + " " + o[key]; }
function storeByName(o, value) { o.x = value; }
function storeByKey(o, k, value) { o[k] = value; }

function run(create) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) {
    const o = hidden(create());
    const defined = describe(o);
    storeByName(o, i & 1);
    storeByKey(o, key, i & 1);
    const stored = describe(o);
    storeByName(o, true);
    storeByKey(o, key, null);
    answers.add(defined + ", " + stored + ", " + describe(o));
  }
  return [...answers].join(" | ");
}

console.log("defined once: " + run(() => new DefinedOnce()));
console.log("defined twice: " + run(() => new DefinedTwice()));
console.log("defined once again: " + run(() => new DefinedOnce()));

function add(o, value) { o.added = value; }
{
  const answers = new Set();
  const keysAtBirth = Object.keys(Host());
  for (let i = 0; i < turns; i++) {
    const o = hidden(new DefinedTwice());
    add(o, i & 1);
    answers.add(typeof o.added + " " + o.added + " " + Object.keys(o).filter(name => !keysAtBirth.includes(name)).join());
  }
  console.log("added by a store: " + [...answers].join(" | "));
}
