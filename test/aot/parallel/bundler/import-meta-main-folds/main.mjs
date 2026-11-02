console.log(import.meta.main);
if (!import.meta.main) await import("./missing");
const other = await import("./other");
console.log(other.isMain);
