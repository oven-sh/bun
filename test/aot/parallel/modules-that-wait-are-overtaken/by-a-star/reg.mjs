import { setLate, setGauge, setMark } from "./hooks.mjs"; import { readLate, askGauge, askMark } from "./d.mjs"; setLate(readLate); setGauge(askGauge); setMark(askMark);
