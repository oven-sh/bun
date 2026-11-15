try {
  await import("./start.mjs");
} catch (error) {
  console.log("threw", error.name, String(error.message).replace(/'[^']*[\\/]/, "'"));
}
