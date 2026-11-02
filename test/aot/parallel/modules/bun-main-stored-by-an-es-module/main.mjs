// Alone: which file is the main module goes by the entry points of the executable
import other from "./other.cjs";
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
console.log("at first", import.meta.main, nameOf(import.meta.require.main), nameOf(other.main()), other.isMain());
Bun.main = other.me.filename;
console.log("stored", import.meta.main, nameOf(import.meta.require.main), nameOf(other.main()), other.isMain(), other.main() === other.me);
