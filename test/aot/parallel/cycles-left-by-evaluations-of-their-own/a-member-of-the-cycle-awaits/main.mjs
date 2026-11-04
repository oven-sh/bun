const said = await import("./first.mjs").then(() => "fulfilled", error => "rejected " + error.message);
console.log("first:", said);
console.log("second:", await import("./second.mjs").then(it => "fulfilled " + it.ok, error => "rejected " + error.message));
console.log("outside:", await import("./outside.mjs").then(it => "fulfilled " + it.seen, error => "rejected " + error.message));
