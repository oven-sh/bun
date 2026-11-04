type Page = { default: string; name: string };
const pages = import.meta.glob<Page>("./pages/*.ts");
console.log(Object.keys(pages).join());
for (const key in pages) console.log(key, typeof pages[key], (await pages[key]()).default);

const names = import.meta.glob(["./pages/**/*.ts", "!**/skip.ts"], { import: "name" });
for (const key in names) console.log(key, await names[key]());

const based = import.meta.glob("./*.ts", { base: "./pages" });
console.log(Object.keys(based).join(), (await based["./a.ts"]()) === (await pages["./pages/a.ts"]()));

const raw = import.meta.glob("./data/*.txt", { query: "?raw", import: "default" });
for (const key in raw) console.log(key, JSON.stringify(await raw[key]()));

console.log(
  JSON.stringify(import.meta.glob("./nothing/*.ts")),
  Object.keys(import.meta.glob("./pages/deep/*.ts")).join(),
);
