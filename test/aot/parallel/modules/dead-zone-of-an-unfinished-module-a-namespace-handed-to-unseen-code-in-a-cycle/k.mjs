import * as ns from "./m.mjs";
console.log("k:", new Function("ns", "look", "return look(ns)")(ns, (ns => { const seen = []; for (const key of ["f", "s", "C"]) { try { seen.push(key + ":" + typeof ns[key]); } catch (error) { seen.push(key + ":" + error.constructor.name); } } return seen.join(" "); })));
