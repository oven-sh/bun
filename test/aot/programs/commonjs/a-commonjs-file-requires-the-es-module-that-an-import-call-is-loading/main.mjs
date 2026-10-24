let loaded;
try {
  loaded = await import("./ma.mjs");
} catch (error) {
  console.log("main:", error.name);
}
console.log("early:", loaded?.early, "late:", loaded?.late());
