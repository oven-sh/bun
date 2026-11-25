// `Math.max(...Array(100000))`: every hole arrives as undefined.
function run(t) { return Math.max(...Array(100000)) + ":" + t; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
