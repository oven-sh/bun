try {
  await import("./throws.js");
} catch (error) {
  postMessage("caught " + error.message);
}
