// ES modules written in JavaScript in the style of lodash-es: `var x = ..; export default x`.
import Sym from "./esm/_Symbol.js"
import root from "./esm/_root.js"
console.log(typeof Sym, Sym === Symbol, root === globalThis)
