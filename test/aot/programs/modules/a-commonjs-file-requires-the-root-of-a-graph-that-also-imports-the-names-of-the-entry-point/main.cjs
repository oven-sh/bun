// Two graphs are imported one after the other. In each, back.cjs lies two levels below the root and requires the root, and another branch ends in a module that imports the names of the entry point:
// one level below the root in the first graph, two levels in the second.
console.log("main begins");
exports.early = 1;
setTimeout(async () => {
  console.log("near has", Object.keys(await import("./near/a.mjs")).join());
  console.log("far has", Object.keys(await import("./far/a.mjs")).join());
}, 1);
