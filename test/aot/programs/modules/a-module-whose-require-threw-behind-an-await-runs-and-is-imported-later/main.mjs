// Two modules wait for a module that awaits. The first of them to go on requires a module that imports the second, which has not gone on yet, so require() throws. The required module runs as soon as the second has, and a later import() of it settles. Plain Bun prints another output.
Promise.all([import("./requires.mjs"), import("./waits.mjs")]).then(() => {
  console.log("both are imported");
  import("./required.mjs").then(names => console.log("required is imported:", Object.keys(names).join()));
});
