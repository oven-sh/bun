for (let turn = 0; turn < 2; turn++) {
  try {
    require("./app.mjs");
    console.log("loaded");
  } catch (error) {
    console.log("caught", error.name);
  }
}
