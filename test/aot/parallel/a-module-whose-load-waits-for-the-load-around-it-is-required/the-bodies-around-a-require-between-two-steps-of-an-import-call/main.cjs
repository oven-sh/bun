setTimeout(() => {
  import("./site.mjs").then(got => console.log("import gave", got.name));
  Promise.resolve()
    .then(() => {})
    .then(() => {})
    .then(() => console.log("require gave", require("./site.mjs").name));
}, 0);
