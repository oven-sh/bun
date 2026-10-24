// A program gives a host constructor a Symbol.hasInstance of its own, by the constructor's name.
function isResponse(x) { return x instanceof Response; }
function isHeaders(x) { return x instanceof Headers; }
const values = [new Response("a"), new Headers(), {}, 5];
const ask = () => values.map(value => +isResponse(value) + "" + +isHeaders(value)).join();
for (let i = 0; i < 50; i++) ask();
console.log(ask());
try { Object.defineProperty(Response, Symbol.hasInstance, { value: x => x === 5, configurable: true }); console.log("defined"); } catch (error) { console.log("refused", error.name); }
console.log(ask());
try { delete Response[Symbol.hasInstance]; console.log("deleted"); } catch (error) { console.log("refused", error.name); }
console.log(ask());
