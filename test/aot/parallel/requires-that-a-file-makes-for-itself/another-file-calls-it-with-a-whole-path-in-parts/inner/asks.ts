import { load } from "./maker.ts";
const pick = () => (process.argv.length < 99 ? "value" : "other");
export const ask = () => load(import.meta.dirname + "/" + pick() + ".cjs");
