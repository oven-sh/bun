// for-in over a Proxy at the top level, in a function, a method and a class field. The keys come from the traps, and the traps' side effects are visible after the loop.
// Flags: --aot-check=flow-fixpoint
const descriptor = { value: 1, enumerable: true, configurable: true };
const handlerWithKeys = keys => ({ ownKeys: () => keys, getOwnPropertyDescriptor: () => descriptor });
const topLevel = [];

const topLevelProxy = new Proxy({}, handlerWithKeys(["first", "second"]));
for (const key in topLevelProxy) topLevel.push(key, key === "first");

function keysOf(object) {
  const keys = [];
  for (const key in object) keys.push(key, key === "a");
  return keys.join(" ");
}

class Walker {
  keys = (() => {
    const keys = [];
    for (const key in new Proxy({ field: 1 }, {})) keys.push(key);
    return keys;
  })();
  lastKey(object) {
    let last = "none";
    for (const key in object) last = key;
    return last;
  }
}
const walker = new Walker();

const source = new Proxy({ a: 1, b: "two" }, { get: (target, key) => (key === "a" ? "from the trap" : target[key]) });
const copy = {};
for (const key in source) copy[key] = source[key];

const state = { count: 0 };
const mutatesState = new Proxy({}, { ownKeys() { state.count = "text"; return []; } });

const targets = [];
const mutatesTarget = new Proxy({ a: 1 }, { ownKeys(target) { targets.push(target); target.b = "added"; return Reflect.ownKeys(target); } });
const types = [];
for (const key in mutatesTarget) types.push(key, typeof mutatesTarget[key]);

console.log(topLevel.join(" "));
console.log(keysOf({ a: 1 }), "|", keysOf(new Proxy({ z: 1 }, {})), "|", keysOf(new Proxy({}, handlerWithKeys(["q"]))));
console.log(walker.keys.join(), walker.lastKey(new Proxy({}, handlerWithKeys(["m"]))), walker.lastKey({ only: 1 }));
console.log(JSON.stringify(copy), typeof copy.a, typeof copy.b);
console.log(walker.lastKey(mutatesState), typeof state.count, state.count + 1);
console.log(types.join(" "), Object.keys(targets[0]).join(), typeof targets[0].b);
