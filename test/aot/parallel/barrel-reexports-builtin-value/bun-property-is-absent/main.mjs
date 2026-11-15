try {
  const { value } = await import("./reads.mjs");
  console.log(typeof value);
} catch (error) {
  console.log(error.name);
}
