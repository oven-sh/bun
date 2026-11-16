globalThis.turn = 0;
for (let turn = 0; turn < 2; turn++) {
  await import("./fails-once.cjs").then(
    () => console.log("loaded"),
    error => console.log("caught", error.message),
  );
}
await import("./tool.cjs");
