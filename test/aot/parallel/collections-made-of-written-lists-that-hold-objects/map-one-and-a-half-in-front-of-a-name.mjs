const show = (o) => Object.keys(o).join() + " " + JSON.stringify(o);
const table = new Map([["k", { 1.5: "half", name: "x" }]]);
console.log(show(table.get("k")), table.size);
