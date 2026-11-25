globalThis.order ??= [];
// Which of two graphs comes first is up to the reads. Their files don't mix.
const runsOfGraphs = () => {
  const graphs = order.splice(0).map(name => name.split("-")[0]);
  return graphs.length + " files, " + (1 + graphs.filter((graph, index) => index && graph !== graphs[index - 1]).length) + " runs";
};
await Promise.all([import("./first.mjs"), import("./second.mjs")]);
console.log(runsOfGraphs());
await Promise.all([import("./deep.mjs"), import("./deeper.mjs")]);
console.log(runsOfGraphs());
await Promise.all([import("./plain.mjs"), import("./mixed.mjs")]);
console.log(runsOfGraphs());
