let said = "";
try {
  const found = await import("./head.mjs");
  said = found.told;
} catch (error) {
  said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
}
console.log(said);
