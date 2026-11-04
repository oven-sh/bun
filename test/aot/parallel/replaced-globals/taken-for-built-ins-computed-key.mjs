// The build takes console, Promise and Map for the built-ins where no code of the program writes them: what a built-in is passed it does not change. This program does write them, under keys that are made when it runs: each write is honored, or refused as the docs say, and compiled code goes by what then lies there.
const say = (...words) => process.stdout.write(words.join(" ") + "\n");
const tried = action => { try { action(); return "done"; } catch (error) { return error.constructor.name; } };
class Point { x = 1; }
function logged() { const point = new Point(); console.log(point); return typeof point.x; }
function promised() { const point = new Point(); new Promise(resolve => resolve(point)); return typeof point.x; }
function resolved() { const point = new Point(); Promise.resolve(point); return typeof point.x; }
function looked() { const point = new Point(); new Map().get(point); return typeof point.x; }
function ourLog(value) { value.x = "changed"; }
class OurPromise { constructor(run) { run(value => { value.x = "changed"; }); } static resolve(value) { value.x = "changed"; } }
function ourGet(key) { key.x = "changed"; }
const [log, promise, get] = JSON.parse('["log", "Promise", "get"]');
say(tried(() => { console[log] = ourLog; }), tried(() => { globalThis[promise] = OurPromise; }), tried(() => { Map.prototype[get] = ourGet; }));
say("console.log", logged());
say("new Promise", promised());
say("Promise.resolve", resolved());
say("Map.prototype.get", looked());
/* Output:
done done TypeError
console.log string
new Promise string
Promise.resolve string
Map.prototype.get number
*/
