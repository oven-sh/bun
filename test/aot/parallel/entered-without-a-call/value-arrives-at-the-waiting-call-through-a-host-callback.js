// onText() is called behind `typeof part === "string"`, and every call of take() in sight passes a number. The host hands take() texts: it is the callback of String.prototype.replace and of a timer
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::isReached of onText(): a call behind a test is entered when something passes the test
let log = "";
function onText(part) { log += "text " + part + "; "; return part; }
function onOther(part) { log += "other " + String(part) + "; "; return "-"; }
function take(part) { return typeof part === "string" ? onText(part) : onOther(part); }
function deed(part) { log = ""; take(part); return log; }
console.log(deed(1), deed(2));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(turn);
console.log(last);
log = "";
console.log("a-b".replace(/[ab]/g, take), log);
log = "";
setTimeout(take, 0, "late");
setTimeout(() => console.log(log), 1);
