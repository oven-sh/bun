// A name that a module does not export is read off `import * as`, as a value and as a test: undefined for an ES module, also for `default` behind `export *`; what is there for a name that a star carries, for CommonJS and for JSON.
import * as plain from "./plain.js";
import * as bare from "./bare.js";
import * as starred from "./starred.js";
import * as circle from "./circle.js";
import * as ambiguous from "./ambiguous.js";
import * as overCommonJS from "./over-commonjs.js";
import * as commonjs from "./commonjs.cjs";
import * as emptyCommonJS from "./empty.cjs";
import * as data from "./data.json";

const lines = [];
const shown = value => (typeof value === "function" ? "function" : (JSON.stringify(value) ?? "undefined"));
const say = (label, ...values) => lines.push(label + ": " + values.map(shown).join(" "));
const taken = [];

say("plain", plain.named, plain.default, plain.then, plain.missing, plain.toString, plain.constructor, plain.__proto__, plain.__esModule);
if (plain.default) taken.push("plain.default");
if (typeof plain.then === "function") taken.push("plain.then");
if (plain.missing && plain.missing.deeper) taken.push("plain.missing");
if (plain.missing === undefined) taken.push("plain.missing is undefined");
if (plain.named) taken.push("plain.named");
say("plain, by default", plain.missing ?? "nothing", plain.missing || "nothing", plain.missing?.deeper, plain.named ?? "nothing");

say("bare", bare.default, bare.then, Object.keys(bare));
if (bare.default) taken.push("bare.default");

say("starred", starred.carried, starred.default, starred.then, starred.missing, Object.keys(starred));
if (starred.default) taken.push("starred.default");
if (typeof starred.then === "function") taken.push("starred.then");
if (starred.missing) taken.push("starred.missing");

say("circle", circle.one, circle.two, circle.default, circle.three);
if (circle.three) taken.push("circle.three");
if (circle.two) taken.push("circle.two");

say("ambiguous", ambiguous.same, ambiguous.first, ambiguous.second, Object.keys(ambiguous));
if (ambiguous.same) taken.push("ambiguous.same");

say("over CommonJS", overCommonJS.named, overCommonJS.then, overCommonJS.default, overCommonJS.missing);
if (overCommonJS.then) taken.push("overCommonJS.then");
if (overCommonJS.default) taken.push("overCommonJS.default");

say("CommonJS", commonjs.named, commonjs.then, commonjs.default, commonjs.missing);
if (commonjs.default) taken.push("commonjs.default");
if (commonjs.missing) taken.push("commonjs.missing");

say("empty CommonJS", emptyCommonJS.default, emptyCommonJS.missing);
if (emptyCommonJS.default) taken.push("emptyCommonJS.default");

say("JSON", data.named, data.default, data.missing);
if (data.default) taken.push("data.default");
if (data.missing) taken.push("data.missing");

say("taken", taken);
console.log(lines.join("\n"));
