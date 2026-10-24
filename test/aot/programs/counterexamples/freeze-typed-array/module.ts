declare const console: { log(...a: unknown[]): void };
export const bytes = Object.freeze(new Uint8Array(1));
console.log("evaluated");
