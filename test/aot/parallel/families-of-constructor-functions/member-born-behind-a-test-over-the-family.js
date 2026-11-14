// work() asks the guards of the three classes in one test and makes a Sledge behind it in the same turn. Its loop is built twice (the dead zone of bonus is asked in front), so no closed arm meets the typed way between the two.
// No Sledge was made before, and unseen text has stored a list under Sledge.prototype, which the run time takes for the prototype of no class: each Sledge stands below the list.
function Carrier() { this.weight = 1; }
Carrier.prototype.load = function (n) { return this.weight + n; };
function Wagon() { Carrier.call(this); this.wheels = 4; }
Object.setPrototypeOf(Wagon.prototype, Carrier.prototype);
function Sledge() { Carrier.call(this); this.runners = 2; }
Object.setPrototypeOf(Sledge.prototype, Carrier.prototype);
var last;
function work(c, count) { var total = 0; for (var i = 0; i < count; i++) { total += c.load(i) + bonus; last = new Sledge(); } return total; }
let bonus = 0;
globalThis.hook = work;
globalThis.classes = { Carrier, Wagon, Sledge };
const change = (text) => (0, eval)(text);
change("var list = []; list.load = function (n) { return 500 + n; }; classes.Sledge.prototype = list;");
let sum = work(new Wagon(), 3);
if (process.argv.length > 7) sum += work(new Sledge(), 1) + work(new Carrier(), 1);
sum += globalThis.hook(new Wagon(), 3);
console.log(sum, last.load(1), Object.getPrototypeOf(last) === Sledge.prototype);
