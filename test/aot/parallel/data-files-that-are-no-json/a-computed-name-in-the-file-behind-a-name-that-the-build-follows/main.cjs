for (const name of ["good", "settings"]) {
  try {
    console.log("loaded", JSON.stringify(require("./" + name + ".json")));
  } catch (error) {
    console.log("caught", error.name, error.message);
  }
}
