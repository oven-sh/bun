let at = 0;
if (process.argv.length > 90) at = 1;

function objectOfMap(either) {
  const bound = new Map([["a", either]]).get("a");
  return typeof bound === "object";
}
function looseOfMap(either) {
  const bound = new Map([["a", either]]).get("a");
  return typeof bound == "object";
}
function notOfMap(either) {
  const bound = new Map([["a", either]]).get("a");
  return typeof bound !== "object";
}
function armOfMap(either) {
  const bound = new Map([["a", either]]).get("a");
  if (typeof bound === "object") return "object"; return "other " + bound.length;
}
function callableOfMap(either) {
  const bound = new Map([["a", either]]).get("a");
  if (typeof bound === "function") return "function " + bound.length; return "other";
}
function kindsOfMap(either) {
  const bound = new Map([["a", either]]).get("a");
  switch (typeof bound) { case "function": return 1; case "object": return 2; case "string": return 3; case "number": return 4; default: return 5; }
}
const keptByObjectOfList = [];
function objectOfList(either) {
  const list = [either, either]; keptByObjectOfList.push(list); const bound = list[at];
  return typeof bound === "object";
}
const keptByLooseOfList = [];
function looseOfList(either) {
  const list = [either, either]; keptByLooseOfList.push(list); const bound = list[at];
  return typeof bound == "object";
}
const keptByNotOfList = [];
function notOfList(either) {
  const list = [either, either]; keptByNotOfList.push(list); const bound = list[at];
  return typeof bound !== "object";
}
const keptByArmOfList = [];
function armOfList(either) {
  const list = [either, either]; keptByArmOfList.push(list); const bound = list[at];
  if (typeof bound === "object") return "object"; return "other " + bound.length;
}
const keptByCallableOfList = [];
function callableOfList(either) {
  const list = [either, either]; keptByCallableOfList.push(list); const bound = list[at];
  if (typeof bound === "function") return "function " + bound.length; return "other";
}
const keptByKindsOfList = [];
function kindsOfList(either) {
  const list = [either, either]; keptByKindsOfList.push(list); const bound = list[at];
  switch (typeof bound) { case "function": return 1; case "object": return 2; case "string": return 3; case "number": return 4; default: return 5; }
}
function objectOfWeak(either) {
  const key = {}; const bound = new WeakMap([[key, either]]).get(key);
  return typeof bound === "object";
}
function looseOfWeak(either) {
  const key = {}; const bound = new WeakMap([[key, either]]).get(key);
  return typeof bound == "object";
}
function notOfWeak(either) {
  const key = {}; const bound = new WeakMap([[key, either]]).get(key);
  return typeof bound !== "object";
}
function armOfWeak(either) {
  const key = {}; const bound = new WeakMap([[key, either]]).get(key);
  if (typeof bound === "object") return "object"; return "other " + bound.length;
}
function callableOfWeak(either) {
  const key = {}; const bound = new WeakMap([[key, either]]).get(key);
  if (typeof bound === "function") return "function " + bound.length; return "other";
}
function kindsOfWeak(either) {
  const key = {}; const bound = new WeakMap([[key, either]]).get(key);
  switch (typeof bound) { case "function": return 1; case "object": return 2; case "string": return 3; case "number": return 4; default: return 5; }
}
const keptByObjectOfLast = [];
function objectOfLast(either) {
  const list = [either]; keptByObjectOfLast.push(list); const bound = list.pop();
  return typeof bound === "object";
}
const keptByLooseOfLast = [];
function looseOfLast(either) {
  const list = [either]; keptByLooseOfLast.push(list); const bound = list.pop();
  return typeof bound == "object";
}
const keptByNotOfLast = [];
function notOfLast(either) {
  const list = [either]; keptByNotOfLast.push(list); const bound = list.pop();
  return typeof bound !== "object";
}
const keptByArmOfLast = [];
function armOfLast(either) {
  const list = [either]; keptByArmOfLast.push(list); const bound = list.pop();
  if (typeof bound === "object") return "object"; return "other " + bound.length;
}
const keptByCallableOfLast = [];
function callableOfLast(either) {
  const list = [either]; keptByCallableOfLast.push(list); const bound = list.pop();
  if (typeof bound === "function") return "function " + bound.length; return "other";
}
const keptByKindsOfLast = [];
function kindsOfLast(either) {
  const list = [either]; keptByKindsOfLast.push(list); const bound = list.pop();
  switch (typeof bound) { case "function": return 1; case "object": return 2; case "string": return 3; case "number": return 4; default: return 5; }
}

function show(ask) {
  try {
    return String(ask());
  } catch (error) {
    return error.constructor.name;
  }
}

console.log("object Map", show(() => objectOfMap("text")), show(() => objectOfMap(JSON)), show(() => objectOfMap("text")));
console.log("loose Map", show(() => looseOfMap(1.5)), show(() => looseOfMap(Math)), show(() => looseOfMap(1.5)));
console.log("not Map", show(() => notOfMap([1, 2, 3])), show(() => notOfMap(Array.prototype)), show(() => notOfMap([1, 2, 3])));
console.log("arm Map", show(() => armOfMap(((a) => a))), show(() => armOfMap(console)), show(() => armOfMap(((a) => a))));
console.log("callable Map", show(() => callableOfMap(null)), show(() => callableOfMap(process)), show(() => callableOfMap(null)));
console.log("kinds Map", show(() => kindsOfMap("text")), show(() => kindsOfMap(JSON)), show(() => kindsOfMap("text")));
console.log("object List", show(() => objectOfList(1.5)), show(() => objectOfList(Math)), show(() => objectOfList(1.5)));
console.log("loose List", show(() => looseOfList([1, 2, 3])), show(() => looseOfList(Array.prototype)), show(() => looseOfList([1, 2, 3])));
console.log("not List", show(() => notOfList(((a) => a))), show(() => notOfList(console)), show(() => notOfList(((a) => a))));
console.log("arm List", show(() => armOfList(null)), show(() => armOfList(process)), show(() => armOfList(null)));
console.log("callable List", show(() => callableOfList("text")), show(() => callableOfList(JSON)), show(() => callableOfList("text")));
console.log("kinds List", show(() => kindsOfList(1.5)), show(() => kindsOfList(Math)), show(() => kindsOfList(1.5)));
console.log("object Weak", show(() => objectOfWeak([1, 2, 3])), show(() => objectOfWeak(Array.prototype)), show(() => objectOfWeak([1, 2, 3])));
console.log("loose Weak", show(() => looseOfWeak(((a) => a))), show(() => looseOfWeak(console)), show(() => looseOfWeak(((a) => a))));
console.log("not Weak", show(() => notOfWeak(null)), show(() => notOfWeak(process)), show(() => notOfWeak(null)));
console.log("arm Weak", show(() => armOfWeak("text")), show(() => armOfWeak(JSON)), show(() => armOfWeak("text")));
console.log("callable Weak", show(() => callableOfWeak(1.5)), show(() => callableOfWeak(Math)), show(() => callableOfWeak(1.5)));
console.log("kinds Weak", show(() => kindsOfWeak([1, 2, 3])), show(() => kindsOfWeak(Array.prototype)), show(() => kindsOfWeak([1, 2, 3])));
console.log("object Last", show(() => objectOfLast(((a) => a))), show(() => objectOfLast(console)), show(() => objectOfLast(((a) => a))));
console.log("loose Last", show(() => looseOfLast(null)), show(() => looseOfLast(process)), show(() => looseOfLast(null)));
console.log("not Last", show(() => notOfLast("text")), show(() => notOfLast(JSON)), show(() => notOfLast("text")));
console.log("arm Last", show(() => armOfLast(1.5)), show(() => armOfLast(Math)), show(() => armOfLast(1.5)));
console.log("callable Last", show(() => callableOfLast([1, 2, 3])), show(() => callableOfLast(Array.prototype)), show(() => callableOfLast([1, 2, 3])));
console.log("kinds Last", show(() => kindsOfLast(((a) => a))), show(() => kindsOfLast(console)), show(() => kindsOfLast(((a) => a))));
