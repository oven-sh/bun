// `bun run` declares `require`, `__filename` and `__dirname` as variables at the head of an ES module that names them, so the text of a direct eval finds them and may store to them.
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
console.log(typeof require, typeof __filename, typeof __dirname);
console.log(say(() => eval("typeof require + typeof __filename + typeof __dirname")));
console.log(say(() => eval("require") === require), say(() => eval("__filename") === __filename), say(() => eval("__dirname") === __dirname));
console.log(say(() => eval("require") === import.meta.require), say(() => eval("require('node:path').sep") === require("node:path").sep));
function declared() { return eval("typeof require"); }
class C { static s = eval("typeof __filename"); m() { return eval("typeof __dirname"); } static { console.log(eval("typeof require")); } }
console.log(say(declared), C.s, say(() => new C().m()), say(() => (() => () => eval("typeof require"))()()));
console.log(say(() => eval("(() => typeof __dirname)()")), say(() => eval("eval('typeof require')")), say(() => (0, eval)("typeof require")));
console.log(say(() => eval("var require = 2; require")), typeof require, say(() => require("node:path").sep === "/" || true));
console.log(say(() => eval("__dirname = 'stored'; __dirname")), __dirname, say(() => eval("__dirname")));
console.log(say(() => eval("__filename += '!'; __filename.endsWith('!')")), __filename.endsWith("!"));
const kept = require;
console.log(say(() => eval("require = s => 'mine ' + s; require('a')")), say(() => require("b")), say(() => eval("require('c')")), kept === import.meta.require);
console.log(say(() => eval("delete require")), say(() => eval("typeof module + typeof exports")));
