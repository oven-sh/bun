// The program reads RegExp.$1: every match shows.
const log = [];
const PARTS = ["k=v"].map(s => s.replace(/(\w)=(\w)/, "$2=$1"));
log.push(RegExp.$1 + RegExp.$2 + " " + RegExp.lastMatch);
/(z)/.test("z");
log.push(RegExp.$1);
log.push(PARTS.join());
log.push(RegExp.$1);
console.log(log.join("\n"));
