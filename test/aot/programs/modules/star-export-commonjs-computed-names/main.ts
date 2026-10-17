// `export * from` a CommonJS module hands on whatever that module has put on its exports when it ran, also under names that no text shows. An initializer that looks for such a name in the namespace finds it, and what it then does happens where the constant is declared.
import * as library from "./library";
import { log } from "./log";
function tell(): { size: number } { log.push("found"); return { size: 2 }; }
function pick(from: { early: number; late?: { size: number } }): { size: number } { return from.late ? tell() : { size: 0 }; }
const picked = pick(library);
const listed = Object.keys(library);
const copied = { ...library };
function read(): string { return JSON.stringify([picked, listed, copied]); }
log.push("loaded");
console.log(read(), log.join());
