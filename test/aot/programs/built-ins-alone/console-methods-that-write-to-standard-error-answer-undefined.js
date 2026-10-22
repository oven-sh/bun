console.log(console.error("error") === undefined, console.warn("warn") === undefined);
console.time("span");
console.log(console.timeLog("never started") === undefined, console.timeEnd("never started") === undefined);
