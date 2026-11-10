import { read, readByExpression, Reader } from "./exporter.mjs";
export const early = [];
export function callAll() { return read({ a: 1 }) + " " + readByExpression({ a: 1 }) + " " + new Reader().read({ a: 1 }); }
early.push(read({ a: 1 }));
