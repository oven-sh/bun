// `[...Array(1000000)]`: one written number sets the length in sight. The spread is one operation; it is not written out place by place.
function run(t) { const list = [...Array(1000000)]; return list.length + ":" + list[0] + ":" + (999999 in list) + ":" + t; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
