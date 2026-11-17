try {
  await import("./page.mjs");
  console.log("loaded");
} catch (error) {
  console.log("caught", error.name);
}
