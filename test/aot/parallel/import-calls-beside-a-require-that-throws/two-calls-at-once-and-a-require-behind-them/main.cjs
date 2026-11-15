// Each call fetches the file. The second fetch ends behind the throw, so the require() runs the file again. A later import() gets the first error.
(async () => {
  const settled = await Promise.allSettled([import("./flaky.cjs"), import("./flaky.cjs")]);
  console.log(settled.map((each) => each.reason.message).join(", "));
  console.log("required", require("./flaky.cjs").value, "runs", globalThis.runs);
  await import("./flaky.cjs").catch((error) => console.log("import rejected", error === settled[0].reason));
  console.log("required again", require("./flaky.cjs").value, "runs", globalThis.runs);
})();
