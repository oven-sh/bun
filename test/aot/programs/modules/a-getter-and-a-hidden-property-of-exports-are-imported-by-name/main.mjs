// A getter and a hidden property of exports are imported by name.
import d, { live, hidden } from "./m.cjs";
import * as ns from "./m.cjs";
console.log(live, hidden, Object.keys(ns).sort().join(), typeof d, d.live);
