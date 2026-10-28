// Which file of the cycle is loaded first is known when the program runs.
const names = process.argv.length > 7 ? ["./first.js", "./second.js"] : ["./second.js", "./first.js"];
if (names[0] === "./first.js") await import("./first.js");
else await import("./second.js");
console.log("main", (await import("./first.js")).a, (await import("./second.js")).b);
