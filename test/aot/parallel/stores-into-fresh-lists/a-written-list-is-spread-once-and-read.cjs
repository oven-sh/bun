// One spread of a written list beside other elements: it is written out: the length and the elements of the new list are in sight.
function run(t) { const first = [t, t + 1]; const all = [0, ...first, 9]; return all.length + ":" + all[0] + ":" + all[1] + ":" + all[2] + ":" + all[3]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
