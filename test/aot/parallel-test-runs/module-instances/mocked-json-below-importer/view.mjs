globalThis.runs = (globalThis.runs ?? 0) + 1;
import d, { word } from "./data.json";
import * as all from "./data.json";
export const view = () => [d.word, word, all.word, (() => word)()].join();
