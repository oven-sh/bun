postMessage("loading");
for (let i = 0; ; i++) {
  const tables = await import("./tables-part.ts");
  if (tables.build(1000 + (i % 7)) < 0) break;
}
export {};
