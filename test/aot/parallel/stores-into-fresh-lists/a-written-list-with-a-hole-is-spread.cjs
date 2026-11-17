// A written list with a hole is spread: the hole arrives as undefined and is an element of the new list.
function run(t) { const all = [...[t, , t + 1]]; return all.length + ":" + all[0] + ":" + all[1] + ":" + (1 in all) + ":" + all[2]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
