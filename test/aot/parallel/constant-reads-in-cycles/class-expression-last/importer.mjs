import { Gauge } from "./exporter.mjs";
export function call(word) { try { console.log(word, new Gauge().mode); } catch (error) { console.log(word, error.name); } }
