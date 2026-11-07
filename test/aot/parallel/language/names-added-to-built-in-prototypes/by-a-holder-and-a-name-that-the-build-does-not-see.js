// Each built-in object takes a new name by every road, though the build sees neither the object nor the name at the store, and says that it is extensible. Two do not: nothing can be added to Object.prototype, which says so, and Function.prototype takes a text only where the build sees it.
const GP = Object.getPrototypeOf(function* () {}).prototype;
const holders = {
  "Object.prototype": Object.prototype, "Function.prototype": Function.prototype, "Array.prototype": Array.prototype, "String.prototype": String.prototype,
  "Promise.prototype": Promise.prototype, "RegExp.prototype": RegExp.prototype, "%Generator%": GP, "Map.prototype": Map.prototype, "Math": Math, "JSON": JSON, "Promise": Promise, "Object": Object,
  "URL.prototype": URL.prototype, "Headers.prototype": Headers.prototype, "URLSearchParams.prototype": URLSearchParams.prototype, "Request.prototype": Request.prototype, "Response.prototype": Response.prototype,
};
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
for (const name of Object.keys(holders)) {
  const h = holders[name];
  console.log(name, "| extensible", Object.isExtensible(h), Reflect.isExtensible(h), "| sealed", Object.isSealed(h), "frozen", Object.isFrozen(h),
    "| strict assign", attempt(() => { "use strict"; h.extraOne = 1; return h.extraOne; }),
    "| define", attempt(() => { Object.defineProperty(h, "extraTwo", { value: 2, configurable: true, writable: true }); return h.extraTwo; }),
    "| Reflect.set", attempt(() => Reflect.set(h, "extraThree", 3) + " " + h.extraThree),
    "| symbol", attempt(() => { const s = Symbol("mine"); h[s] = 4; return h[s]; }),
    "| delete", attempt(() => delete h.extraTwo));
}
/* Output:
Object.prototype | extensible false false | sealed false frozen false | strict assign TypeError | define TypeError | Reflect.set false undefined | symbol TypeError | delete true
Function.prototype | extensible true true | sealed false frozen false | strict assign TypeError | define TypeError | Reflect.set false undefined | symbol 4 | delete true
Array.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
String.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Promise.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
RegExp.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
%Generator% | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Map.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Math | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
JSON | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Promise | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Object | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
URL.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Headers.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
URLSearchParams.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Request.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
Response.prototype | extensible true true | sealed false frozen false | strict assign 1 | define 2 | Reflect.set true 3 | symbol 4 | delete true
*/
