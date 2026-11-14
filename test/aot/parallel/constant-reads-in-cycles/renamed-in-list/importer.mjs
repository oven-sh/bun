import { other } from "./exporter.mjs";
export function call(word) { try { console.log(word, other()); } catch (error) { console.log(word, error.name); } }
