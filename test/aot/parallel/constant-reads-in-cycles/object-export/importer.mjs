import { api } from "./exporter.mjs";
export function call(word) { try { console.log(word, api.read()); } catch (error) { console.log(word, error.name); } }
