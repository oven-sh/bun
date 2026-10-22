// no trip: nothing but `new` and `instanceof` uses the class. trip (same build): argv decides nothing here; the variants are separate classes of one program.
// closed: only new and instanceof. stored: the class object is also stored under a computed key of an object. changed: a property is stored on the class object under a computed key (never run).
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 5000000);
const variant = process.argv[4] ?? "closed";

class Closed { constructor(x) { this.x = x; } }
class Stored { constructor(x) { this.x = x; } }
class Changed { constructor(x) { this.x = x; } }
class Other { constructor(x) { this.x = x; } }
const registry = {};
registry["st" + (process.argv[9] ?? "ored")] = Stored;
if (process.argv.length > 20) Changed[process.argv[20]] = 1;

function closed(values) { let sum = 0; for (let i = 0; i < N; i++) sum += values[i & 3] instanceof Closed ? 1 : 0; return sum; }
function stored(values) { let sum = 0; for (let i = 0; i < N; i++) sum += values[i & 3] instanceof Stored ? 1 : 0; return sum; }
function changed(values) { let sum = 0; for (let i = 0; i < N; i++) sum += values[i & 3] instanceof Changed ? 1 : 0; return sum; }
function kind(values) { let text = 0; for (let i = 0; i < N; i++) text += (typeof values[i & 3]).length; return text; }
const mixed = trip ? [new Closed(1), new Stored(2), new Changed(3), new Other(4)] : [new Other(1), new Other(2), new Other(3), new Other(4)];
console.log({ closed, stored, changed, kind }[variant](mixed));
