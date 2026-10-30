for (const load of [() => import("./late.js"), () => import("absent")]) {
  try {
    await load();
  } catch (error) {
    console.log("x of", String(error).replace(/ in module.*/, ""));
  }
}
