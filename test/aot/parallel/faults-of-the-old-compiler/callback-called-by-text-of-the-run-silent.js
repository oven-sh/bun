let fired = 0;
function onTime(by) { fired += by === undefined ? 1 : by; }
const t = setTimeout(onTime, 100000);
new Function("t", process.argv[2] ?? "t._onTimeout('text')")(t);
clearTimeout(t);
console.log(typeof fired, fired);
