// byName() is called behind `typeof id === "string"`, and every call of pick() in sight passes a number. The one text comes out of JSON.parse
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::isReached of byName(): a call behind a test is entered when something passes the test
function byName(id) { return "name " + id; }
function byIndex(id) { return "index " + String(id); }
function pick(id) { return typeof id === "string" ? byName(id) : byIndex(id); }
function deed(id) { return pick(id); }
console.log(deed(1), deed(2));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn);
console.log(log);
const outside = JSON.parse('["a", 3, "b", null]');
for (let i = 0; i < outside.length; i++) console.log(deed(outside[i]));
console.log(deed(4));
