import { all } from "./barrel.mjs";
export function call(word) { try { console.log(word, all.read()); } catch (error) { console.log(word, error.name); } }
