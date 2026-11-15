import { read } from "./barrel.mjs";
export function call(word) { try { console.log(word, read()); } catch (error) { console.log(word, error.name); } }
