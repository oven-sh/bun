// A written list grown by a push and by a store at its length is spread.
function run(t) { const first = [t]; first.push(t + 1); first[2] = t + 2; const all = [...first]; return all.length + ":" + all[0] + ":" + all[1] + ":" + all[2]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
