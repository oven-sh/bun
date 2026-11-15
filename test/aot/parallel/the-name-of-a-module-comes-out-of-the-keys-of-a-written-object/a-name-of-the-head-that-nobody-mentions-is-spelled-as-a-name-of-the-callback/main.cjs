const said = [];
for (const [os, it] of [["one", { name: "./a.cjs" }], ["two", { name: "./b.cjs" }]].filter(([os]) => os !== "z")) said.push(require(it.name));
console.log("SAID", said.join(" "));
