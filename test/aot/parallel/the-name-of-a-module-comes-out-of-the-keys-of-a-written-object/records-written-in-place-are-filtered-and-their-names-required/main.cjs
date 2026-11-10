const said = [];
for (const it of [process.argv[2] === "off" ? null : { name: "./one.cjs" }, { name: "./two.cjs" }].filter(it => it)) {
  said.push(require(it.name).name);
}
console.log("SAID", said.join(" "));
