const TruePromise = Promise, TrueError = Error;
function isPromise(x) { return x instanceof Promise; }
function isError(x) { return x instanceof Error; }
globalThis.kept = [isPromise, isError];
const things = [TruePromise.resolve(1), { then() {} }, new TypeError("t"), 7, null, []];
const tell = when => console.log(when, globalThis.kept.map(test => things.map(test).map(Number).join("")).join(" "));
tell("as made"); tell("again");
let replaced = false;
try { globalThis.Promise = class Other {}; globalThis.Error = class Another {}; replaced = globalThis.Promise !== TruePromise; } catch (error) { console.log("refused:", error.constructor.name); }
things.push(new globalThis.Promise(() => {}), new globalThis.Error("e"));
tell("replaced " + replaced); tell("again");
globalThis.Promise = TruePromise; globalThis.Error = TrueError;
tell("put back"); tell("again");
