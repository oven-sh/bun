// The everyday spelling: `[...Array(5)].map((_, i) => ..)`: the spread turns the holes into undefined, so that map visits each.
function run(t) { return [...Array(5)].map((_, i) => i * t).join() + ":" + Array(5).map((_, i) => i).join(); }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
