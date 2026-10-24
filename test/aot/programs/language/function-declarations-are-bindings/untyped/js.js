class Base { constructor(a, b) { this.sum = a + b; this.count = arguments.length } }
class Derived extends Base { constructor() { super(...arguments); this.extra = arguments[0] } }
const d = new Derived(3, 4, 5)
console.log(d.sum, d.count, d.extra)
function Stream(x) { this.x = x }
const first = Stream
Stream = function (x) { this.x = x * 2 }
console.log(new first(2).x, new Stream(2).x, first === Stream)
function RAL() { return "ral" }
(function (RAL) { RAL.installed = true })(RAL || (RAL = {}))
console.log(RAL(), RAL.installed)
