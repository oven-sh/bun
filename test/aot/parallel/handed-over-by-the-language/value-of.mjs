const seen = [];
class K { valueOf(hint) { seen.push("hint:" + typeof hint + (hint === undefined ? "!" : "")); return 1; } }
new K().valueOf(7);
+new K();
console.log(seen.join(" "));
