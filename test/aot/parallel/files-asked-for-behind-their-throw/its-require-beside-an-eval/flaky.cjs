console.log("flaky runs", laters.length, eval("typeof require"));
laters.push(() => require("./value.cjs").value);
laters.push((load => () => load("./value.mjs").value)(require));
if (laters.length < 4) throw new Error("flaky threw");
