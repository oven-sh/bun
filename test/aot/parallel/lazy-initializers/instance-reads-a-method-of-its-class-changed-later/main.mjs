// The initializer reads a name through the objects above a function or an array that it has made. Those objects get, lose or change the name later.
// Alone: what is put off goes by all that the executable holds
import { read, Thing } from "./m.mjs";
const before = Thing.prototype.label;
Thing.prototype.label = function () { return "second"; };
try { console.log(read().seen, read().held === before, read().held()); } catch (e) { console.log(e.name + ": " + e.message); }
