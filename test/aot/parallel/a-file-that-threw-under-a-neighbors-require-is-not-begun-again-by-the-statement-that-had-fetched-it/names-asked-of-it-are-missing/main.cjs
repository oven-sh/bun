for (const name of ["./by-name.mjs", "./handed-on.mjs", "./by-star.mjs"]) {
  globalThis.boils = 0;
  try {
    console.log(name, "gave:", JSON.stringify(Object.keys(require(name))));
  } catch (error) {
    console.log(name, "threw:", error.name, error.message.slice(0, error.message.indexOf("found") + 5));
  }
}
