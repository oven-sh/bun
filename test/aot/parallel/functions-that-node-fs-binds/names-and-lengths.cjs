// What the functions of node:fs say of themselves, whichever of it is asked, defined or deleted first.
const fs = require("fs"), util = require("util");
const names = ["appendFileSync", "chmodSync", "closeSync", "fstatSync", "lstatSync", "readFileSync", "readdirSync", "statSync", "accessSync", "openSync"];
const own = f => Reflect.ownKeys(f).map(String).join();
const shown = (f, key) => JSON.stringify(Object.getOwnPropertyDescriptor(f, key));
console.log(util.inspect(fs.closeSync), util.format("%s %o", fs.readFileSync, 1), String(fs.statSync), Bun.inspect(fs.fstatSync));
console.log(names.map(name => fs[name].name + fs[name].length + fs[name].bind().name).join());
names.forEach((name, i) => {
  const f = fs[name], steps = [];
  const ask = [() => own(f), () => shown(f, "name"), () => shown(f, "length"), () => f.hasOwnProperty("name"), () => Object.keys(f).join() + JSON.stringify({ ...f }), () => util.inspect(f, { showHidden: true }).split("\n")[0]];
  for (let k = 0; k < ask.length; k++) steps.push(ask[(k + i) % ask.length]());
  console.log(steps.join(" "));
});
for (const name of names) {
  const f = fs[name];
  switch (names.indexOf(name) % 5) {
    case 0: Object.defineProperty(f, "name", { value: "other" }); break;
    case 1: delete f.name; break;
    case 2: f.name = "ignored"; Object.defineProperty(f, "length", { value: 9, enumerable: true }); break;
    case 3: delete f.length; f.extra = 1; break;
    case 4: Object.defineProperty(f, "name", { get() { return "computed"; } }); Object.freeze(f); break;
  }
  console.log(own(f), f.name, f.length, shown(f, "name"), shown(f, "length"), util.inspect(f), String(f).slice(0, 18), f.bind().name, Object.isFrozen(f));
}
console.log(fs.closeSync.name, fs.readFileSync.name, fs.fstatSync.length, fs.lstatSync.name, (({ readdirSync }) => readdirSync.length)(fs));
