// Whoever has the object that require() answers can store `__esModule` on it, assign it, define it or delete it. A read by name in another place sees that.
function store(object, value) {
  object.__esModule = value;
}

const handedOver = require("./handed-over.mjs");
console.log(handedOver.__esModule, handedOver.count);
store(handedOver, false);
console.log(handedOver.__esModule, require("./handed-over.mjs").__esModule, handedOver.count);
store(handedOver, "text");
console.log(handedOver.__esModule, handedOver["__esModule"]);

const assigned = require("./assigned.mjs");
Object.assign(assigned, { __esModule: 0 });
console.log(assigned.__esModule, assigned.count);

const changedElsewhere = require("./changed-elsewhere.mjs");
console.log(changedElsewhere.__esModule, changedElsewhere.count);
require("./changes-the-marks.cjs");
console.log(changedElsewhere.__esModule, require("./changed-elsewhere.mjs").__esModule, changedElsewhere.count);

const marked = require("./marked.cjs");
console.log(marked.__esModule, require("./marked.cjs").__esModule, "__esModule" in marked, marked.count);

const stored = require("./stored.cjs");
store(stored, undefined);
console.log(stored.__esModule, stored.count);

function readEarly() {
  return onlySeen.__esModule;
}
try {
  readEarly();
} catch (error) {
  console.log(error.constructor.name);
}
const onlySeen = require("./only-seen.mjs");
console.log(readEarly(), onlySeen?.__esModule, typeof onlySeen.__esModule, onlySeen.count);
import("./only-seen.mjs").then(namespace => {
  console.log(namespace.__esModule, namespace === require("./only-seen.mjs"), onlySeen.__esModule);
});
