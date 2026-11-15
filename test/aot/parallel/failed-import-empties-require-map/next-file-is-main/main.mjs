for (const load of [() => import("./fails.cjs"), () => import("./tool.cjs"), () => import("./other.cjs")]) {
  await load().then(
    () => console.log("loaded"),
    error => console.log("caught", error.message),
  );
}
