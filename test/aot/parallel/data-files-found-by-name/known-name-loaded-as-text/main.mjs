import path from "node:path";
const at = path.join(process.argv[2] ?? import.meta.dirname, "good.json");
console.log(JSON.stringify((await import(at, { with: { type: "text" } })).default));
console.log(JSON.stringify((await import(at, { with: { type: "json" } })).default));
console.log(JSON.stringify((await import(at)).default));
