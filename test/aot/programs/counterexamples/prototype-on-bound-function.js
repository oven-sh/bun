// A `prototype` stored on a bound function does not decide `instanceof`: the target has none, so it throws.
const b = (() => 1).bind(null);
b.prototype = Array.prototype;
try { console.log([] instanceof b); } catch (e) { console.log(e.constructor.name); }
