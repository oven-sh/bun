// replaced.cjs requires an ES module that imports it back, and replaces module.exports behind that. The link takes what module.exports holds while the body runs, for the default import and for `default` of the namespace object alike.
import replaced from "./replaced.cjs";
import * as namespace from "./replaced.cjs";
import filled, * as filledNamespace from "./filled.cjs";
import { show } from "./reads-the-default.mjs";

function describe() {
  return [
    replaced === namespace.default,
    JSON.stringify(replaced),
    JSON.stringify(namespace.default),
    filled === filledNamespace.default,
    show(),
  ].join(" ");
}
console.log(describe());
setTimeout(() => console.log(describe(), JSON.stringify(filled), JSON.stringify(require("./replaced.cjs"))));
