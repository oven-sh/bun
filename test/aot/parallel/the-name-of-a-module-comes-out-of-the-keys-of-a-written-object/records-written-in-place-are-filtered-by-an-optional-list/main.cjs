const said = [];
for (const it of [
  { name: "./one.cjs", tags: ["x"] },
  { name: "./two.cjs", tags: ["x"] },
  { name: "./extra.cjs" },
].filter(it => it.tags && it.tags.includes("x"))) {
  said.push(require(it.name).name);
}
console.log("SAID", said.join(" "));
