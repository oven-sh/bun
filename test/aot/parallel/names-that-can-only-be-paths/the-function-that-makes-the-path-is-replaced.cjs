// The build takes what `path.join(__dirname, ..)` and `path.resolve(..)` answer for a path from the root, and brings no module of the library for it. A text that is none is refused.
const path = require("node:path");
const { join, resolve } = path;
const name = process.argv[5] ?? "querystring";
const rows = [];
const row = (title, replace, load) =>
  rows.push(async () => {
    replace();
    try {
      console.log(title, typeof (await load()));
    } catch (error) {
      console.log(title, "throws", error.code ?? error.name);
    } finally {
      path.join = join;
      path.resolve = resolve;
    }
  });
const last = (...parts) => parts[parts.length - 1];
let asked = 0;
const twoTexts = () => ({ toString: () => (asked++ ? name : "/none") });

row("join answers the name", () => (path.join = last), () => require(path.join(__dirname, name)));
row("resolve answers the name", () => (path.resolve = last), () => require(path.resolve(name)));
row("resolve answers the name, import", () => (path.resolve = last), () => import(path.resolve(name)));
row("resolve answers an object", () => (path.resolve = twoTexts), () => require(path.resolve(name)));
row("join answers another path from the root", () => (path.join = () => "/none"), () => require(path.join(__dirname, name)));
row("join does what it did", () => (path.join = (...parts) => join(...parts)), () => require(path.join(__dirname, "none-" + name)));

(async () => {
  for (const run of rows) await run();
})();
/* Output:
join answers the name throws MODULE_NOT_FOUND
resolve answers the name throws MODULE_NOT_FOUND
resolve answers the name, import throws ERR_MODULE_NOT_FOUND
resolve answers an object throws MODULE_NOT_FOUND
join answers another path from the root throws MODULE_NOT_FOUND
join does what it did throws MODULE_NOT_FOUND
*/
