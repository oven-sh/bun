// `for (8 turns) list = [...list, ...list, ...list, ...list]`: 65,536 places at the run. The turns are written out; the build followed every place of every list.
function run(t) { let list = [t]; for (let i = 0; i < 8; i++) list = [...list, ...list, ...list, ...list]; return list.length + ":" + list[0] + ":" + list[65535]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
