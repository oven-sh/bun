// The package defines the marker of an ES module and a getter that only names a function of its own. The build makes neither call.
// `bun run` makes both and has read defineProperty off Object, which lists the member from then on.
const { names } = require("declared-1");
const listed = Object;
console.log("copied", names(Object.assign({}, listed)));
console.log("own keys", String(Reflect.ownKeys(listed)));
