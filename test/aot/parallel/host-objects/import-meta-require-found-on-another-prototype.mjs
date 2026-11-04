// import.meta.require behind Object.setPrototypeOf is the function of the new prototype: it is called with the name as written, and nothing is loaded.
const calls = [];
Object.setPrototypeOf(import.meta, {
  require(name) {
    calls.push(this === import.meta);
    return "mine " + name;
  },
});
const held = import.meta;
const computed = "./" + ["no-such-file", "mjs"].join(".");
try {
  console.log(import.meta.require("./no-such-file.mjs"));
  console.log(import.meta.require("node:path"));
  console.log(import.meta.require(computed));
  console.log(held.require("./no-such-file.mjs"), typeof import.meta.require, typeof import.meta.require.resolve);
} catch (error) {
  console.log(error.constructor.name, error.message);
}
console.log(calls.join());
