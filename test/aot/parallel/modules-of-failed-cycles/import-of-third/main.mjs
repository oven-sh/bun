const errors = [];
try {
  await import("./a.mjs");
  console.log("a loads");
} catch (error) {
  errors.push(error);
  console.log("a", error.message, errors.indexOf(error));
}
try {
  await import("./c.mjs");
  console.log("c loads");
} catch (error) {
  errors.push(error);
  console.log("c", error.message, errors.indexOf(error));
}
