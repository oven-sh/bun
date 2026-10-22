// What a built-in answers is made by the built-in. The compiler reads a model of it, which is never run: the object has no layout of the model, whatever is defined on it later.
function show(v) {
  let t = typeof v;
  try { t += "|" + Reflect.ownKeys(v).map(String).join(); } catch (e) { t += "|" + e.name; }
  try { t += "|" + (Object.getPrototypeOf(v) === null ? "null" : typeof Object.getPrototypeOf(v)); } catch (e) { t += "|" + e.name; }
  try { t += "|" + Object.isFrozen(v) + Object.isExtensible(v); } catch (e) { t += "|" + e.name; }
  return t;
}
function hc3(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c3() { const o = Object.fromEntries([]); const said = hc3(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
let said; try { said = c3(); } catch (e) { said = "throws " + e.constructor.name; }
console.log(said);
