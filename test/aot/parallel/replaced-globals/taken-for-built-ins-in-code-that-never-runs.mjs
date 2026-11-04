// The build takes console, Promise and Map for the built-ins where no code of the program writes them: what a built-in is passed it does not change. This program does write them, in a function that nothing calls, and in text: each write is honored, or refused as the docs say, and compiled code goes by what then lies there.
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
function never() { console.log = ourLog; globalThis.Promise = OurPromise; }
globalThis.ours = { ourLog, OurPromise, ourGet };
say(tried(() => (0, eval)("console.log = ours.ourLog")), tried(() => (0, eval)("Promise = ours.OurPromise")), tried(() => (0, eval)("Map.prototype.get = ours.ourGet")));
say("console.log", logged());
say("new Promise", promised());
say("Promise.resolve", resolved());
say("Map.prototype.get", looked());
/* Output:
TypeError TypeError TypeError
Point {
  x: 1,
}
console.log number
new Promise number
Promise.resolve number
Map.prototype.get number
*/
