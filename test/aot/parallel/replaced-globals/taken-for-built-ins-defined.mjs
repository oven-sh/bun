// The build takes console, Promise and Map for the built-ins where no code of the program writes them: what a built-in is passed it does not change. This program does write them, by Object.defineProperty: each write is honored, or refused as the docs say, and compiled code goes by what then lies there.
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
say(tried(() => { Object.defineProperty(console, "log", { value: ourLog }); }), tried(() => { Object.defineProperty(globalThis, "Promise", { value: OurPromise }); }), tried(() => { Object.defineProperty(Map.prototype, "get", { value: ourGet }); }));
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
