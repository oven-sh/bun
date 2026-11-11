function load({ files }) {
  for (const file of files) console.log("SAID", require(file).name);
}
load({ files: ["./one.cjs", "./two.cjs"] });
