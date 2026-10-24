try {
  console.log("second", [0].map(globalThis.leaked).join());
} catch (error) {
  console.log("second", error.constructor.name);
}
