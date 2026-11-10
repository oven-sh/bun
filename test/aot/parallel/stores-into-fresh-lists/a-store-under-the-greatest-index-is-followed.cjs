// 4,294,967,294 is the greatest index: the store under it is followed, and the length in sight becomes the greatest length.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
function run(t) { const list = [t]; list[4294967294] = t + 1; return list.length + ":" + list[4294967294] + ":" + list[1] + ":" + (1 in list) + ":" + list[0]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
