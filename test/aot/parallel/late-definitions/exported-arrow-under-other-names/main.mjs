// One function under several names: a name of another spelling, the default, a name that another file hands on, what require answers. Whoever asks gets the one object.
import * as between from "./between.mjs";
import byDefault, { renamed, readArrow, list } from "./m.mjs";
import asks from "./asks.cjs";
const pick = name => (process.argv.length > 100 ? "x" : "") + name;
console.log(between[pick("passedOn")] === renamed, between[pick("passedOnDefault")] === byDefault, between[pick("renamed")] === readArrow(), byDefault === renamed);
console.log(asks.ask(), asks.take() === renamed, list[0] === renamed, list[1] === between[pick("other")]);
console.log(Object.keys(between).join(), renamed.name, between[pick("other")].name, renamed(3));
