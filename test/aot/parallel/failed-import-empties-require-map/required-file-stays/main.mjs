for (const load of [() => import("./fails.cjs"), () => import("./tool.cjs")]) {
  await load().then(
    () => console.log("loaded"),
    error => console.log("caught", error.message),
  );
}
