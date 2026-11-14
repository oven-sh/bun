// Of the three only Wagon ever makes an object: the test over the family passes from the second entry on.
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
for (let i = 0; i < 1000; i++) sum = (sum + globalThis.hook(wagon, i & 7)) | 0;
console.log(sum);
