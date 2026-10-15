// The namespace object of a module whose default export refers to a binding.
import * as whole from "./req/named.js"
import * as lit from "./req/literal.js"
import * as fn from "./req/fn.js"
const seen: any = whole
console.log(Object.keys(seen).sort().join(), seen.default?.name, seen.other, Object.keys(lit).join(), (lit as any).default.name, typeof (fn as any).default)
