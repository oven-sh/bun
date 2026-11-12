// Error.stackTraceLimit stored in loops: around an error, by name and by key, values that are no numbers, read through classes below Error and native constructors, sites that see other objects as well.
const lines = [];
const frames = error => typeof error.stack === "string" ? error.stack.split("\n").length - 1 : String(error.stack);
const initial = Error.stackTraceLimit;
class Mine extends Error {}
class Own extends Error { static stackTraceLimit = 2; }
function deep(n, make) { const error = n ? deep(n - 1, make) : make(); error.depth = n; return error; }
function around(turns) {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = i % 4;
    const error = deep(6, () => { const error = new Error("m"); error.made = true; return error; });
    Error.stackTraceLimit = limit;
    seen += frames(error) + "/" + frames(deep(1, () => { const error = new Error("n"); error.made = true; return error; })) + " ";
  }
  return seen;
}
function values(turns) {
  const kinds = [3, 2.5, -1, 0, NaN, Infinity, "4", undefined, null, {}, true, 1, 2];
  let seen = "";
  for (let i = 0; i < turns; i++) {
    Error.stackTraceLimit = kinds[i % kinds.length];
    seen += frames(deep(5, () => { const error = new Error("m"); error.made = true; return error; })) + "," + String(Mine.stackTraceLimit) + "," + String(TypeError.stackTraceLimit) + " ";
  }
  Error.stackTraceLimit = initial;
  return seen;
}
function byKey(turns, key) {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    Error[key] = i % 3;
    seen += frames(deep(4, () => { const error = new TypeError("m"); error.made = true; return error; })) + (Error[key] === i % 3) + " ";
  }
  Error[key] = initial;
  return seen;
}
function anyObject(objects, turns) {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    const object = objects[i % objects.length];
    object.stackTraceLimit = i % 5;
    seen += object.stackTraceLimit + ":" + Error.stackTraceLimit + ":" + frames(deep(5, () => { const error = new Error("m"); error.made = true; return error; })) + " ";
  }
  Error.stackTraceLimit = initial;
  return seen;
}
function below(turns) {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    Error.stackTraceLimit = i % 3;
    Mine.stackTraceLimit = 1;
    seen += frames(deep(4, () => { const error = new Mine("m"); error.made = true; return error; })) + frames(deep(4, () => { const error = new Own("m"); error.made = true; return error; })) + Object.hasOwn(Mine, "stackTraceLimit") + Own.stackTraceLimit + " ";
    delete Mine.stackTraceLimit;
    seen += Mine.stackTraceLimit + " ";
  }
  Error.stackTraceLimit = initial;
  return seen;
}
function thrown(turns) {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    Error.stackTraceLimit = 1 + i % 2;
    try { deep(3, () => null.x); } catch (error) { seen += frames(error); }
    try { deep(3, () => JSON.parse("{")); } catch (error) { seen += frames(error); }
    const holder = {}; Error.captureStackTrace(holder); seen += frames(holder) + " ";
  }
  Error.stackTraceLimit = initial;
  return seen;
}
function counted(turns) { Error.stackTraceLimit = 0; for (let i = 0; i < turns; i++) Error.stackTraceLimit++; const limit = Error.stackTraceLimit; Error.stackTraceLimit += 0.5; const half = Error.stackTraceLimit; Error.stackTraceLimit = initial; return limit + " " + half; }
for (let turn = 0; turn < 2; turn++) {
  lines.push(around(9), values(26), byKey(7, "stackTraceLimit"), anyObject([Error, { stackTraceLimit: 1 }, Error, Mine, {}], 12), below(5), thrown(6), counted(5));
  delete Mine.stackTraceLimit;
}
lines.push(String(Error.stackTraceLimit === initial), Object.getOwnPropertyDescriptor(Error, "stackTraceLimit").enumerable + "");
for (const line of lines) console.log(line);
