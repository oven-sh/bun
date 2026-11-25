// Sledge.prototype is replaced whole by unseen text behind the arming; a Sledge made later answers by the new object.
function Carrier() { this.weight = 1; }
Carrier.prototype.load = function (n) { return this.weight + n; };
function Wagon() { Carrier.call(this); this.wheels = 4; }
Object.setPrototypeOf(Wagon.prototype, Carrier.prototype);
function Sledge() { Carrier.call(this); this.runners = 2; }
Object.setPrototypeOf(Sledge.prototype, Carrier.prototype);
function haul(c, n) { return c.load(n); }
globalThis.hook = haul;
globalThis.classes = { Carrier, Wagon, Sledge };
const change = (text) => (0, eval)(text);
let sum = 0;
const wagon = new Wagon();
sum += haul(wagon, 0);
if (process.argv.length > 7) sum += haul(new Sledge(), 1) + haul(new Carrier(), 1);
for (let i = 0; i < 10; i++) { if (i === 5) change("classes.Sledge.prototype = { load(n) { return 400 + n; } }"); sum += globalThis.hook(wagon, i); }
const late = new Sledge();
for (let i = 0; i < 10; i++) sum += globalThis.hook(late, i) + globalThis.hook(wagon, i);
console.log(sum, late instanceof Carrier, late instanceof Sledge);
