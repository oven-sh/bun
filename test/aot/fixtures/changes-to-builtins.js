// For the programs about locked built-ins. Tries every way to change a property or the prototype of an object, and prints what each way answered and whether the object changed. What changed is put back at once.
import { assign, remove } from "./changes-to-builtins-sloppy.cjs";

function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
function replacement() { return "replaced"; }

function answersForProperty(object, key) {
  const was = Object.getOwnPropertyDescriptor(object, key);
  const isUnchanged = () => {
    const now = Object.getOwnPropertyDescriptor(object, key);
    return was ? !!now && now.value === was.value && now.get === was.get && now.set === was.set : !now;
  };
  const answers = [];
  const note = (way, run) => {
    const answer = attempt(run);
    answers.push(way + " " + answer + "/" + (isUnchanged() ? "unchanged" : "changed"));
    if (isUnchanged()) return;
    if (was) Object.defineProperty(object, key, was);
    else delete object[key];
  };
  note("store", () => { object[key] = replacement; return "done"; });
  note("sloppy store", () => assign(object, key, replacement));
  note("Reflect.set", () => Reflect.set(object, key, replacement));
  note("define", () => { Object.defineProperty(object, key, { value: replacement, writable: true, configurable: true }); return "done"; });
  note("Reflect.defineProperty", () => Reflect.defineProperty(object, key, { get: replacement, configurable: true }));
  note("delete", () => delete object[key]);
  note("sloppy delete", () => remove(object, key));
  note("Reflect.deleteProperty", () => Reflect.deleteProperty(object, key));
  return answers.join(", ");
}

// One line for the keys that answer alike.
export function tryToChange(name, object, keys) {
  const groups = [];
  for (const key of keys) {
    const answers = answersForProperty(object, key);
    let group = groups.find(group => group.answers === answers);
    if (!group) groups.push(group = { answers, keys: [] });
    group.keys.push(String(key));
  }
  for (const group of groups) console.log(name + ": " + group.keys.join(" ") + ": " + group.answers);
}

export function tryToChangePrototype(name, object) {
  const was = Object.getPrototypeOf(object);
  const answers = [];
  const note = (way, run) => {
    const answer = attempt(run);
    const isUnchanged = Object.getPrototypeOf(object) === was;
    answers.push(way + " " + answer + "/" + (isUnchanged ? "unchanged" : "changed"));
    if (!isUnchanged) Object.setPrototypeOf(object, was);
  };
  note("Object.setPrototypeOf", () => { Object.setPrototypeOf(object, Object.create(was)); return "done"; });
  note("Reflect.setPrototypeOf", () => Reflect.setPrototypeOf(object, Object.create(was)));
  note("__proto__", () => { object.__proto__ = Object.create(was); return "done"; });
  note("the prototype it has", () => { Object.setPrototypeOf(object, was); return "done"; });
  console.log(name + ": its prototype: " + answers.join(", ") + ", extensible " + Object.isExtensible(object));
}

export const wellKnownSymbols = [
  Symbol.asyncDispose, Symbol.asyncIterator, Symbol.dispose, Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.iterator, Symbol.match, Symbol.matchAll,
  Symbol.replace, Symbol.search, Symbol.species, Symbol.split, Symbol.toPrimitive, Symbol.toStringTag, Symbol.unscopables,
];
export const indexLikeKeys = [0, 5, "7", "4294967294", "4294967295", "-1", "1.5", "-0", "NaN", "Infinity", "-Infinity", "1e+21"];
export const keysThatOnlyLookNumeric = ["01", "1.0", "+1", "1e3", "0x1"];
