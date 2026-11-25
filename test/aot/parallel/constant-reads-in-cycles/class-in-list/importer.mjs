import { Gauge } from "./exporter.mjs";
export function call(word) { try { console.log(word, new Gauge().mode, new Gauge().read()); } catch (error) { console.log(word, error.name); } }
