var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
const never = process.argv.length > 100;

var walked = {};
__export(walked, { config: () => config });
var config = { toJSON() { return { seen: "toJSON ran" }; } };
console.log("walk", JSON.stringify(walked));

var thenable = {};
__export(thenable, { then: () => then });
function then(resolve) { resolve("then ran"); }
Promise.resolve(thenable).then(value => console.log("thenable", value));

var copied = {};
__export(copied, { make: () => make });
function make() { return "make ran"; }
globalThis.sink = {};
const into = globalThis[never ? "x" : ["si", "nk"].join("")];
Object.assign(into, copied);
console.log("copy", globalThis.sink.make());

var held = {};
__export(held, { run: () => run });
function run() { return "run ran"; }
const map = new Map();
map.set("k", held);
for (const [, value] of map) console.log("held", value.run());

var listed = {};
__export(listed, { alpha: () => alpha, beta: () => beta });
function alpha() { return "alpha ran"; }
function beta() { return "beta ran"; }
console.log("entries", Object.entries(listed).map(([key, value]) => key + "=" + value()).join());
console.log("values", Object.values(listed).map(value => value()).join());
console.log("computed", listed[never ? "x" : ["be", "ta"].join("")]());
console.log("reflect", Reflect.get(listed, "alpha")(), Reflect.ownKeys(listed).length, "alpha" in listed, listed.hasOwnProperty("beta"), listed.gamma);

class Below { }
Object.setPrototypeOf(Below.prototype, listed);
console.log("inherited", new Below().alpha());
const heir = Object.create(listed);
console.log("created", heir.beta());
const clone = structuredClone({ plain: 1 });
console.log("descriptor", typeof Object.getOwnPropertyDescriptor(listed, "alpha").get, Object.getOwnPropertyDescriptor(listed, "alpha").get()());
