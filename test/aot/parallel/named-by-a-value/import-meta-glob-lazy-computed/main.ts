const lazy = import.meta.glob("./modules/*.ts") as any;
const which = (globalThis as any).never ? "a" : "b";
console.log((await lazy["./modules/" + which + ".ts"]()).default);