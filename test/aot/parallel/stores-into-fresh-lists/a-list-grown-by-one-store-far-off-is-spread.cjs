// One store far past the length sets the length in sight; the spread is one operation.
function run(t) { const list = [t]; list[1000000] = t + 1; const all = [...list]; return all.length + ":" + all[0] + ":" + all[1] + ":" + all[1000000]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
