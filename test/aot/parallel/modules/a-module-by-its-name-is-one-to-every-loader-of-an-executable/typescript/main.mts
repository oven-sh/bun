// Reference: bun build --compile
import "./plain.mts";
console.log((globalThis as any).seen.join(" "));
