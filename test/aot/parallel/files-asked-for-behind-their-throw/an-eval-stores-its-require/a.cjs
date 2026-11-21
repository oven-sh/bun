eval("0");
laters.push(() => require("./b.cjs").v);
if (laters.length === 1) eval("require = other");
laters.push(() => require("./b.cjs").v);
if (laters.length < 4) throw new Error("a threw");
