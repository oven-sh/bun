import * as dep from "./dep.mjs";
export const seen = async () => String(dep === (await import("./dep.mjs")));
