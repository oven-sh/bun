// A function without captures that a `const` of a file holds is made when it is first taken, and the run time, which reads an export for whoever asks by a name that is worked out, finds the dead zone and the one function as compiled code does.
import * as ns from "./m.mjs";
import { arrow, named, readArrow, readNamed, early, peek, direct } from "./m.mjs";
const pick = name => (process.argv.length > 100 ? "x" : "") + name;
console.log(early, peek("arrow"), direct());
console.log(ns[pick("never")] === ns[pick("never")], ns[pick("never")](), ns[pick("never")].name);
console.log(ns[pick("arrow")] === arrow, ns[pick("arrow")] === readArrow(), ns[pick("arrow")](1), ns[pick("arrow")].name);
console.log(ns[pick("named")] === named, ns[pick("named")]() === readNamed(), named() === ns[pick("named")]);
console.log(Object.keys(ns).join(), Object.values(ns).map(value => typeof value).join());
console.log(Object.getOwnPropertyDescriptor(ns, pick("arrow")).value === arrow, Reflect.get(ns, pick("arrow")) === readArrow(), pick("arrow") in ns);
const again = await import(pick("./m.mjs"));
console.log(again === ns, again.arrow === arrow, again[pick("readArrow")]() === arrow, again[pick("pattern")] === ns.pattern, again[pick("table")] === ns.table);
ns[pick("arrow")].tag = "kept";
console.log(arrow.tag, readArrow().tag);
