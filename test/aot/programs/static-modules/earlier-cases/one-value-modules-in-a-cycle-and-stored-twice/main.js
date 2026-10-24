// A module that is one function, in a cycle, and one whose `module.exports` is stored twice.
const f = require("./cyc_f"), user = require("./cyc_user"), two = require("./two");
function often(n) { let s = ""; for (let i = 0; i < n; i++) s = two(); return s; }
console.log(f(), f.early, user.late(), two(), often(3));
