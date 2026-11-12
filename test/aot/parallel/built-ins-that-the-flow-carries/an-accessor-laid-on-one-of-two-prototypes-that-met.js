const both = [Object.prototype, Error.prototype];
function lazy(o, k, get) { Object.defineProperty(o, k, { get, configurable: true }); }
let said;
try { lazy(both[JSON.parse("1")], JSON.parse(`"a"`), () => 4); said = new Error("x").a; } catch (caught) { said = caught.constructor.name; }
console.log(said);
