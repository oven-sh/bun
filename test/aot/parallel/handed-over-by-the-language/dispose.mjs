const seen = [];
class R { [Symbol.dispose](hint) { seen.push("hint:" + typeof hint + (hint === undefined ? "!" : "")); } }
new R()[Symbol.dispose](7);
{ using r = new R(); }
console.log(seen.join(" "));
