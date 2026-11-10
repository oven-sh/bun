// `f(...Array(100000))`: written out place by place the call had as many operands, and the build stopped.
function f(...all) { return all.length + ":" + all[99999]; }
globalThis.called = [f];
function run(t) { return f(...Array(100000)) + ":" + t; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
