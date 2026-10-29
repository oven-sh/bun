// `let`, `var`, a name that is stored again, the exports of a CommonJS file and a getter are read when the program runs.
import { mode, enable, early, counter, count, held } from "./live.js";
import * as live from "./live.js";
import { flag, set } from "./values.cjs";
import values from "./values.cjs";
import { computed } from "./getter.cjs";
function show(label) {
  console.log(label, mode ? "on" : "off", live.mode ? "on" : "off", early, counter, held.on ? "held on" : "held off");
}
show("before");
enable();
count();
show("after");
console.log(flag ? "flag" : "no flag", values.flag ? "flag" : "no flag");
set();
console.log(flag ? "flag" : "no flag", values.flag ? "flag" : "no flag", computed, computed);
