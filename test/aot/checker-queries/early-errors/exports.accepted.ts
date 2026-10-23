// export { name } of a name that has no value: a type, a declare, a global. bun run drops the specifier in TypeScript, checked or not.
⏎// @ts-nocheck⏎interface A { x: number }⏎export { A };
⏎// @ts-nocheck⏎type T = number;⏎export { T };
⏎// @ts-nocheck⏎declare const x: number;⏎export { x };
⏎// @ts-nocheck⏎import type { Stats } from "node:fs";⏎export { Stats };
⏎// @ts-nocheck⏎export { Array };
interface A { x: number }⏎export { A };
export { Array };
