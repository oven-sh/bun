console.log("body");
const pages = import.meta.glob("./pages/*.ts", { eager: true });
for (const key in pages) console.log(key, (pages[key] as any).name, Object.keys(pages[key] as any).join());

console.log(
  JSON.stringify(import.meta.glob<string>(["./pages/**/*.ts", "!**/skip.ts"], { import: "default", eager: true })),
);
console.log(JSON.stringify(import.meta.glob("./data/*.txt", { query: "?raw", import: "default", eager: true })));

function inner() {
  return import.meta.glob("./pages/[ab].ts", { eager: true, import: "name" });
}
console.log(JSON.stringify(inner()), inner() !== inner());
