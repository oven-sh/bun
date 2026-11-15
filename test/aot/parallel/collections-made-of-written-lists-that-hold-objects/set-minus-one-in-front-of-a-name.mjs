const show = (o) => Object.keys(o).join() + " " + JSON.stringify(o);
const bag = new Set([{ "-1": "unknown", name: "x" }]);
for (const o of bag) console.log(show(o), bag.size);
