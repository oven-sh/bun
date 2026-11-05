const show = (label, ns) => console.log(label, Object.isExtensible(ns), Object.isSealed(ns), ns.__esModule, Reflect.ownKeys(ns).map(String).join());
exports.show = show;
show("c: e1 star-imported by main", require("./e1.mjs"));
show("c: e2 name-imported by main", require("./e2.mjs"));
show("c: e3 star used only by member", require("./e3.mjs"));
show("c: e4 exported as namespace", require("./e4.mjs"));
show("c: e5 required only", require("./e5.mjs"));
const s = Symbol("mine");
try { Object.defineProperty(require("./e5.mjs"), s, { value: 1, enumerable: true, configurable: true }); } catch (e) { console.log("throws", e.message); }
show("c: e5 with a symbol", require("./e5.mjs"));
console.log(require("./e5.mjs")[s], delete require("./e5.mjs")[s], require("./e5.mjs")[s]);
try { Object.defineProperty(require("./e1.mjs"), s, { value: 1 }); } catch (e) { console.log("throws", e.message); }
try { Object.defineProperty(require("./e5.mjs"), Symbol.toStringTag, { value: "Other" }); } catch (e) { console.log("throws", e.message); }
console.log(Object.prototype.toString.call(require("./e5.mjs")));
function mark(ns, value) { ns.__esModule = value; }
exports.mark = mark;
function define(ns, value) { Object.defineProperty(ns, "__esModule", { value, configurable: true }); }
exports.define = define;
