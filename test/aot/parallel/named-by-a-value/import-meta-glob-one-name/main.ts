const lazy = import.meta.glob("./modules/*.ts", { import: "named" }) as any;
console.log(await lazy["./modules/b.ts"](), await lazy["./modules/a.ts"]());