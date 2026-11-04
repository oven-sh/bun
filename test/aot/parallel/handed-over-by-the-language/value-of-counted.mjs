const seen = [];
class K { valueOf(hint) { seen.push("n:" + arguments.length); return 1; } }
new K().valueOf(7);
+new K();
console.log(seen.join(" "));
