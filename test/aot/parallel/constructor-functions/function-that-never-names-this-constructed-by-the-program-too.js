// A function that never names `this` and that compiled code constructs: directly, out of a box that has left the program's hands, and where it always answers with an object of its own.
const nothing = String(Date.now()).slice(99);
const hand = new Function("value", "return value" + nothing);

function Plain() {}
Plain.prototype.kind = "plain";
const box = { make: Plain };
hand(box);
function attach(root) {
  if (root.cache === null) root.cache = new box.make();
  return root.cache;
}
console.log(
  attach({ cache: null }).kind,
  attach({ cache: null }) instanceof Plain,
  Object.keys(attach({ cache: null })).length,
);

function SafeBuffer(text) {
  return Buffer.from(text);
}
SafeBuffer.prototype = Object.create(Buffer.prototype);
const exported = { Buffer: SafeBuffer };
hand(exported);
function wrap(text) {
  return new exported.Buffer(text);
}
console.log(wrap("abc").length, wrap("ab") instanceof SafeBuffer, new SafeBuffer("a").length);

function MakesMap(key) {
  return new Map([[key, 1]]);
}
const Possibly = typeof WeakMap === "function" ? MakesMap : Map;
function cacheOf(root) {
  let cache = root.cache;
  if (cache === null) cache = root.cache = new Possibly("k");
  return cache;
}
console.log(cacheOf({ cache: null }).size);

function Throws() {
  throw new Error("no");
}
try {
  new Throws();
} catch (error) {
  console.log(error.message);
}
function Either(flag) {
  if (flag) return {};
  return 5;
}
console.log(new Either(true) instanceof Either, new Either(false) instanceof Either);

// Any constructor may arrive here, among them one that only this call constructs.
function OnlyHere() {}
function construct(C, argument) {
  return new C(argument);
}
console.log(
  construct(OnlyHere) instanceof OnlyHere,
  construct(Map).size,
  construct(SafeBuffer, "abcd").length,
  construct(hand(Plain)).kind,
);
