// The statements that lay Sledge below Carrier stand in a function that runs late, as those of a file that is loaded late do. Until then nothing has touched Sledge.prototype and no Sledge is made.
// By its first object unseen text has laid a load of its own on Sledge.prototype: the test in haul() goes by Wagon alone before, and fails from the first Sledge on.
function Carrier() { this.weight = 1; }
Carrier.prototype.load = function (n) { return this.weight + n; };
function Wagon() { Carrier.call(this); this.wheels = 4; }
Object.setPrototypeOf(Wagon.prototype, Carrier.prototype);
function Sledge() { Carrier.call(this); this.runners = 2; }
function loadSledges() { Object.setPrototypeOf(Sledge.prototype, Carrier.prototype); }
function haul(c, n) { return c.load(n); }
globalThis.hook = haul;
globalThis.classes = { Carrier, Wagon, Sledge };
const change = (text) => (0, eval)(text);
let sum = 0;
const wagon = new Wagon();
sum += haul(wagon, 0);
if (process.argv.length > 7) sum += haul(new Sledge(), 1);
for (let i = 0; i < 10; i++) sum += globalThis.hook(wagon, i);
loadSledges();
change("classes.Sledge.prototype.load = function (n) { return 1000 + n; }");
for (let i = 0; i < 10; i++) sum += globalThis.hook(wagon, i);
const late = new Sledge();
for (let i = 0; i < 10; i++) sum += globalThis.hook(late, i) + globalThis.hook(wagon, i);
console.log(sum);
