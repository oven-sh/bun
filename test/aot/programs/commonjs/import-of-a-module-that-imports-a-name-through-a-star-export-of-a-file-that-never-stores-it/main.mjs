try {
  await import("./importer.mjs");
} catch (error) {
  console.log("caught", error.name);
}
