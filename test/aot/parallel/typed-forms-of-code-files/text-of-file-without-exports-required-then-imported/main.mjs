try {
  const text = import.meta.require("./bell.cjs", { type: "text" });
  const first = await import("./bell.cjs");
  console.log(first.default === text.default, import.meta.require("./bell.cjs") === text, globalThis.rung ?? 0);
} catch (error) {
  console.log(error.name);
}
