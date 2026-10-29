// Bun is in unknown hands and may have been written to. A member that the program names only on `await import("bun")` is still in the executable: in a pattern, behind a test, on the awaited value itself.
console.log(Reflect.set(Bun, "color", 1, {}));
const later = async () => {
  const { peek, nanoseconds } = await import("bun");
  return typeof peek === "function" ? [peek(Promise.resolve(7)), typeof nanoseconds()] : "none";
};
console.log(String(await later()));
console.log((await import("bun")).stringWidth("four"));
const bun = await import("bun");
console.log(bun.escapeHTML("<b>"), typeof bun.version);
