// Pairs of loops that make and read the same small objects, written in two ways. ../equivalent-forms.test.ts says which pairs it holds together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

function optionsSpelledOut(options) {
  return { delay: 50, pending: 1000, context: undefined, tree: 0, preload: "", restore: false, missing: null, ...options, strict: options.strict ?? false };
}
function optionsOutOfTheSpread(options) {
  return { delay: 50, pending: 1000, context: undefined, ...options, strict: options.strict ?? false };
}

const listener = () => 1;
const types = ["finish", "close", "error", "finish"];
function tableBelowObjectPrototype(fn) { return { finish: fn, close: undefined }; }
function tableWithoutPrototype(fn) { return { __proto__: null, finish: fn, close: undefined }; }
function countListeners(events, type) {
  let count = 0;
  if (events.finish !== undefined) count++;
  if (events.error === undefined) count++;
  if (events[type] !== undefined) count++;
  return count;
}

const Empty = function () {};
Empty.prototype = Object.create(null);
const names = [["page", "limit", "sort"], ["page", "limit", "sort"]];
function fill(result, [a, b, c], n) {
  result[a] = n;
  result[b] = n + 1;
  result[c] = n + 2;
  return result.page + result.limit + result.sort;
}

function createLogger(holder, namespace) {
  holder.namespace = namespace;
  holder.count = 0;
  Object.defineProperty(holder, "enabled", { enumerable: true, configurable: false, get: () => createLogger.names.length > 0 });
  return holder;
}
createLogger.names = process.argv.length > 9 ? ["x"] : [];
const loggerAsObject = createLogger({}, "router");
const loggerAsFunction = createLogger(function log() {}, "router");

const loops = {
  "a literal that spells the names of its spread": n => { let sum = 0; for (let i = 0; i < n; i++) { const all = optionsSpelledOut({ tree: i, preload: "intent", restore: true, missing: null }); sum += all.delay + all.tree + all.preload.length + (all.restore ? 1 : 0); } return sum; },
  "a literal that gets names from its spread": n => { let sum = 0; for (let i = 0; i < n; i++) { const all = optionsOutOfTheSpread({ tree: i, preload: "intent", restore: true, missing: null }); sum += all.delay + all.tree + all.preload.length + (all.restore ? 1 : 0); } return sum; },
  "a literal below Object.prototype": n => { let sum = 0; for (let i = 0; i < n; i++) sum += countListeners(tableBelowObjectPrototype(listener), types[i & 3]); return sum; },
  "a literal without a prototype": n => { let sum = 0; for (let i = 0; i < n; i++) sum += countListeners(tableWithoutPrototype(listener), types[i & 3]); return sum; },
  "an empty literal filled by key": n => { let sum = 0; for (let i = 0; i < n; i++) sum += fill({}, names[i & 1], i & 7); return sum; },
  "an instance of an empty function filled by key": n => { let sum = 0; for (let i = 0; i < n; i++) sum += fill(new Empty(), names[i & 1], i & 7); return sum; },
  "names and a getter on an object": n => { let sum = 0; for (let i = 0; i < n; i++) sum += (loggerAsObject.enabled ? 1 : 0) + loggerAsObject.namespace.length + loggerAsObject.count; return sum; },
  "names and a getter on a function": n => { let sum = 0; for (let i = 0; i < n; i++) sum += (loggerAsFunction.enabled ? 1 : 0) + loggerAsFunction.namespace.length + loggerAsFunction.count; return sum; },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
