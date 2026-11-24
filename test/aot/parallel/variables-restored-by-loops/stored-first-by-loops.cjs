// A loop stores a variable before its declaration has run: the variable is undefined where the iteration begins.
const count = +process.argv[2] || 40;
const counts = JSON.parse("[1,2,3,4]"), held = JSON.parse("[0.5,2.5]");
function pair(first) { return [1, 2].map(each => each + first); }
try { for (let i = count; i--; ) { counts[i & 3] = pair(i)[0]; last = () => i; } } catch (error) { console.log("loop", error.name); }
var last = () => 5;
try { for (let i = 0; i < count; i++) { last = () => i; } } catch (error) { console.log("loop", error.name); }
function look() { return last(); }
function run() { for (let i = count; i--; ) { counts[i & 3] = pair(i)[0]; held[i] = i; } return held.length; }
console.log(look(), run(), counts.join());
exports.last = last;
