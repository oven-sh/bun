// The exporter throws before its `const` is initialized. A file that imports it later does not run.
try {
  await import("./flags.js");
} catch (error) {
  console.log("first:", error.message);
}
try {
  const reader = await import("./reader.js");
  console.log("reader loaded", reader.read());
} catch (error) {
  console.log("second:", error.constructor.name, error.message);
}
