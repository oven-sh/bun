import { sep } from "node:path";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);
var log = [], Shape, tally;
var require_box = __commonJS((exports) => { log.push("box"); let made = 0; class Box { constructor() { this.id = ++made; } } exports.Box = Box; exports.count = () => made; exports.peer = typeof require_peer().back; if (process.argv[8] !== "quiet") throw new Error("half way"); exports.late = 1; });
var require_peer = __commonJS((exports) => { log.push("peer"); exports.back = require_box().Box; });
var init_shape = __esm(() => { log.push("shape"); let made = 0; Shape = class { constructor() { this.id = ++made; } }; tally = () => made; });
function ask() { try { return require_box(); } catch (e) { return e.message; } }
init_shape(); init_shape();
for (let i = 0; i < 3; i++) init_shape();
const first = ask(), second = ask(), third = ask();
console.log(log.join(), first, second === third, new second.Box().id, new third.Box().id, second.count(), second.peer, second.late, require_peer().back === second.Box, new Shape().id, new Shape().id, tally(), sep.length);
