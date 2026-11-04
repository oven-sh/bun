const lazy = import.meta.glob("./modules/*.ts") as any;
console.log((await lazy["./modules/b.ts"]()).default);