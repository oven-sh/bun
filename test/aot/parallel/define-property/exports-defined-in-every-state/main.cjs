// Definitions on the exports objects of CommonJS files, whose layouts keep a field in the form of each definition in the text.
function show(v) { return typeof v === "function" ? "fn" : typeof v === "symbol" || typeof v === "bigint" ? String(v) : Object.is(v, -0) ? "-0" : v === undefined ? "u" : typeof v === "number" ? String(v) : JSON.stringify(v); }
function describe(o) {
  const parts = [];
  for (const k of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    let held;
    if ("value" in d) held = "=" + show(d.value) + (d.writable ? "W" : "w");
    else held = "(" + (d.get ? "G" + (k === "native" ? "" : show(d.get.call(o) === o ? "self" : d.get.call(o))) : "g") + (d.set ? "S" : "s") + ")";
    parts.push(String(k) + held + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"));
  }
  let walked = "";
  for (const k in o) walked += k + ",";
  return parts.join(" ") + " | " + Object.keys(o).join() + " | " + walked + " | " + (Object.isExtensible(o) ? "X" : "x") + (Object.isSealed(o) ? "S" : "s") + (Object.isFrozen(o) ? "F" : "f");
}
try { console.log("plain:", describe(require("./plain.cjs"))); } catch (e) { console.log("plain: threw", e.constructor.name, e.message); }
try { console.log("twice-same:", describe(require("./twice-same.cjs"))); } catch (e) { console.log("twice-same: threw", e.constructor.name, e.message); }
try { console.log("twice-other:", describe(require("./twice-other.cjs"))); } catch (e) { console.log("twice-other: threw", e.constructor.name, e.message); }
try { console.log("in-a-loop:", describe(require("./in-a-loop.cjs"))); } catch (e) { console.log("in-a-loop: threw", e.constructor.name, e.message); }
try { console.log("frozen-first:", describe(require("./frozen-first.cjs"))); } catch (e) { console.log("frozen-first: threw", e.constructor.name, e.message); }
try { console.log("sealed-first:", describe(require("./sealed-first.cjs"))); } catch (e) { console.log("sealed-first: threw", e.constructor.name, e.message); }
try { console.log("closed-first:", describe(require("./closed-first.cjs"))); } catch (e) { console.log("closed-first: threw", e.constructor.name, e.message); }
try { console.log("closed-by-reflect:", describe(require("./closed-by-reflect.cjs"))); } catch (e) { console.log("closed-by-reflect: threw", e.constructor.name, e.message); }
try { console.log("stored-first:", describe(require("./stored-first.cjs"))); } catch (e) { console.log("stored-first: threw", e.constructor.name, e.message); }
try { console.log("deleted-between:", describe(require("./deleted-between.cjs"))); } catch (e) { console.log("deleted-between: threw", e.constructor.name, e.message); }
try { console.log("other-order:", describe(require("./other-order.cjs"))); } catch (e) { console.log("other-order: threw", e.constructor.name, e.message); }
try { console.log("is-a-prototype:", describe(require("./is-a-prototype.cjs"))); } catch (e) { console.log("is-a-prototype: threw", e.constructor.name, e.message); }
try { console.log("store-below-first:", describe(require("./store-below-first.cjs"))); } catch (e) { console.log("store-below-first: threw", e.constructor.name, e.message); }
try { console.log("other-types:", describe(require("./other-types.cjs"))); } catch (e) { console.log("other-types: threw", e.constructor.name, e.message); }
try { console.log("odd-accessors:", describe(require("./odd-accessors.cjs"))); } catch (e) { console.log("odd-accessors: threw", e.constructor.name, e.message); }
try { console.log("after-collection:", describe(require("./after-collection.cjs"))); } catch (e) { console.log("after-collection: threw", e.constructor.name, e.message); }
try { console.log("seen-half-done:", describe(require("./seen-half-done.cjs"))); } catch (e) { console.log("seen-half-done: threw", e.constructor.name, e.message); }
try { console.log("changed-by-another:", describe(require("./changed-by-another.cjs"))); } catch (e) { console.log("changed-by-another: threw", e.constructor.name, e.message); }
try { console.log("closed-by-another:", describe(require("./closed-by-another.cjs"))); } catch (e) { console.log("closed-by-another: threw", e.constructor.name, e.message); }
try { console.log("many:", describe(require("./many.cjs"))); } catch (e) { console.log("many: threw", e.constructor.name, e.message); }
try { console.log("replaced:", describe(require("./replaced.cjs"))); } catch (e) { console.log("replaced: threw", e.constructor.name, e.message); }
try { console.log("this-and-module:", describe(require("./this-and-module.cjs"))); } catch (e) { console.log("this-and-module: threw", e.constructor.name, e.message); }
try { console.log("result-is-used:", describe(require("./result-is-used.cjs"))); } catch (e) { console.log("result-is-used: threw", e.constructor.name, e.message); }
