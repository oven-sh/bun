const lazy = import.meta.glob("./modules/*.ts") as any;
console.log((await lazy["./modules/a.ts"]()).default, (await lazy["./modules/c.ts"]()).default);