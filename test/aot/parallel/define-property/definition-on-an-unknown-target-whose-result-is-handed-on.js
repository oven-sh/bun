const forward = (target, key, inner) =>
  Object.defineProperty(target, key, {
    enumerable: true,
    get() { return inner; },
    set(value) { inner = value; },
  });
function forwardAny(target, key, inner) {
  Object.defineProperty(target, key, {
    enumerable: true,
    get() { return inner; },
    set(value) { inner = value; },
  });
}
function forwardPrimitive(target, key, inner) {
  Object.defineProperty(target, key, {
    enumerable: true,
    get() { return inner; },
    set(value) { inner = value; },
  });
}
function mirror(target, source) {
  if (!source) return forward(target, "none", 0);
  for (const key in source) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor.get) Object.defineProperty(target, key, { ...descriptor, enumerable: false });
    else forward(target, key, descriptor.value);
  }
  const symbols = Object.getOwnPropertySymbols(source);
  for (let i = 0; i <= symbols.length; i++) if (i < symbols.length || source.member5_1 === 1) forward(target, symbols[i], source[symbols[i]]);
  return target;
}
const tag = Symbol("tag");
function sourceOf(n) {
  const made = {};
  for (let i = 0; i < 50; i++) made["member" + n + "_" + i] = i;
  Object.defineProperty(made, "computed" + n, { get() { return n; }, enumerable: true, configurable: true });
  made[tag] = n;
  return made;
}
let sum = 0;
const all = [];
for (let n = 0; n < 23; n++) {
  const target = n % 2 ? function () {} : {};
  all.push(mirror(target, sourceOf(n)));
}
for (const target of all) for (const key of Reflect.ownKeys(target)) { const v = target[key]; if (typeof v === "number") sum += v; }
all[0].member0_3 = 100;
console.log(sum, all[0].member0_3, Object.keys(all[2]).length, Reflect.ownKeys(all[2]).length, JSON.stringify(Object.getOwnPropertyDescriptor(all[2], "computed2")), JSON.stringify(Object.getOwnPropertyDescriptor(all[2], "member2_1")), all[3][tag]);
try { forwardAny(undefined, "x", 1); } catch (e) { console.log(e.constructor.name, e.message); }
try { forwardAny(1, "x", 1); } catch (e) { console.log(e.constructor.name, e.message); }
const odd = {};
forwardPrimitive(odd, undefined, 1); forwardPrimitive(odd, null, 2); forwardPrimitive(odd, 3, 3); forwardPrimitive(odd, true, 4); forwardPrimitive(odd, 5n, 5); forwardPrimitive(odd, -0, 6); forwardPrimitive(odd, 1.5, 7); forwardPrimitive(odd, "8", 8); forwardPrimitive(odd, "__proto__", 9); forwardPrimitive(odd, NaN, 10);
console.log(Reflect.ownKeys(odd).join(), odd.undefined, odd.null, odd[3], odd.true, odd[5], odd[0], odd["1.5"]);
const frozen = Object.freeze({});
try { forwardAny(frozen, "x", 1); } catch (e) { console.log(e.constructor.name, e.message); }
const log = [];
forwardAny(new Proxy({}, { defineProperty(t, k, d) { log.push(String(k), Object.keys(d).join()); return Reflect.defineProperty(t, k, d); } }), "viaProxy", 1);
console.log(log.join("|"));
const order = [];
const keyObject = { toString() { order.push("key"); return "fromObject"; } };
try { forwardAny(undefined, keyObject, 1); } catch (e) { order.push(e.constructor.name); }
const held = {};
forwardAny(held, keyObject, 2);
forwardAny(held, { [Symbol.toPrimitive]() { order.push("primitive"); return tag; } }, 3);
try { forwardAny(held, { toString() { throw new RangeError("no key"); } }, 4); } catch (e) { order.push(e.message); }
try { forwardPrimitive(null, 7, 1); } catch (e) { order.push(e.constructor.name); }
console.log(order.join(), Reflect.ownKeys(held).map(String).join(), held.fromObject, held[tag], Reflect.ownKeys(odd).join(), odd[8], Object.getOwnPropertyDescriptor(odd, "__proto__").get(), odd.NaN);
const list = [];
forwardPrimitive(list, 2, "two"); forwardPrimitive(list, "length2", 1);
console.log(list.length, list[2], Object.keys(list).join());
try { forwardPrimitive(list, "length", 1); } catch (e) { console.log(e.constructor.name, e.message); }
try { mirror(undefined, null); } catch (e) { console.log(e.constructor.name, e.message); }
try { mirror(7, null); } catch (e) { console.log(e.constructor.name, e.message); }
const given = {};
console.log(mirror(given, null) === given, given.none, forward(given, "more", 5) === given, given.more);
