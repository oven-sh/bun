const seen = [];
class R { [Symbol.dispose](hint) { seen.push("n:" + arguments.length); } }
new R()[Symbol.dispose](7);
{ using r = new R(); }
console.log(seen.join(" "));
