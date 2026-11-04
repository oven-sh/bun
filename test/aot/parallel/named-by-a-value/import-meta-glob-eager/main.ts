const all = import.meta.glob("./modules/*.ts", { eager: true }) as any;
console.log(all["./modules/b.ts"].default, Object.keys(all).join());