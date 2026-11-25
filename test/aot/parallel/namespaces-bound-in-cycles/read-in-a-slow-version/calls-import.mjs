import("./file.cjs").then(file => {
  let names = "";
  for (const name in file) names += name + " ";
  console.log("then:", names);
  globalThis.later();
});
