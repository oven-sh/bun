import read from "./exporter.mjs";
export function call(word) { try { console.log(word, read()); } catch (error) { console.log(word, error.name); } }
