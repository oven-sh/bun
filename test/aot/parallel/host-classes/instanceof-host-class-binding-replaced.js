// The global binding is replaced, a class of the program stands below, and an object is put under the prototype by hand.
function isResponse(x) { return x instanceof Response; }
class Below extends Response {}
const byHand = Object.create(Response.prototype);
const moved = Object.setPrototypeOf(new Response("m"), null);
const values = [new Response("a"), new Below("b"), byHand, moved, new Proxy(new Response("p"), {}), {}];
const ask = () => values.map(value => +isResponse(value)).join("");
for (let i = 0; i < 50; i++) ask();
console.log(ask());
const original = Response;
try { globalThis.Response = class Other {}; console.log("replaced", Response !== original); } catch (error) { console.log("refused", error.name); }
console.log(ask(), values.map(value => +(value instanceof original)).join(""));
