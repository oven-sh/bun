// A type assertion around the options of require() and import() changes no type.
// @ts-ignore
const path: any = require("./oar.ts", { type: "file" } as any);
// @ts-ignore
const sail: any = require("./sail.ts", <any>{ type: "text" });
const mast: any = await import("./mast.ts", { with: { type: "text" } as any } as any);
console.log(typeof path, typeof sail.default, typeof mast.default, (globalThis as any).ran ?? 0);
