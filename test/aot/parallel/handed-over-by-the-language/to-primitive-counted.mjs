const seen = [];
class K { [Symbol.toPrimitive](hint) { seen.push("n:" + arguments.length); seen.push(String(hint)); return 1; } }
new K()[Symbol.toPrimitive](7);
+new K(); `${new K()}`; new K() + "";
console.log(seen.join(" "));
