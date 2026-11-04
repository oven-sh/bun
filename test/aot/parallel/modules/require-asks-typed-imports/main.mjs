// `require()` of a file of data answers what an import has made of the file, under a type too: the namespace object. It asks the imports without a type first,
// then those under any type but "json", then those under "json". What a `require()` has read itself stays its answer.
import typed from "./typed.json" with { type: "json" };
import asText from "./both.json" with { type: "text" };
import asJson from "./both.json" with { type: "json" };
import plain from "./plain-too.json";
import plainTyped from "./plain-too.json" with { type: "json" };

const kind = value =>
  typeof value !== "object" ? typeof value : Object.prototype.toString.call(value).slice(8, -1) + "(" + Object.keys(value) + ")";

const required = require("./typed.json");
typed.fresh = 1;
console.log("typed:", kind(required), required.default === typed, required.default.fresh);

console.log("both:", kind(require("./both.json")), require("./both.json").default === asText, typeof asJson);

console.log("plain too:", kind(require("./plain-too.json")), require("./plain-too.json").default === plain, plain === plainTyped);

const first = require("./required-first.json");
const later = await import("./required-first.json", { with: { type: "json" } });
console.log("required first:", kind(first), kind(later), require("./required-first.json") === first, later.default === first);
