const errors = [];
try {
  await import("./a.mjs");
  console.log("a loads");
} catch (error) {
  errors.push(error);
  console.log("a", error.message, errors.indexOf(error));
}
try {
  await import("./b.mjs");
  console.log("b loads");
} catch (error) {
  errors.push(error);
  console.log("b", error.message, errors.indexOf(error));
}
