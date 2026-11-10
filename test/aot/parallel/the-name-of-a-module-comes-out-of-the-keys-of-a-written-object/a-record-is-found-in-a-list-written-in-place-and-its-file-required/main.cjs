const found = [
  { name: "one", file: "./one.cjs" },
  { name: "two", file: "./two.cjs" },
].find(it => it.name === (process.argv[2] || "two"));
console.log("SAID", require(found.file).name);
