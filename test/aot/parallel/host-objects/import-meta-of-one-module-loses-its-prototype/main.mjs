// Each module has an import.meta of its own. One module takes the prototype of its own away, another hands its import.meta out and this file does it. The others keep their members.
import { ask as askCut, cut } from "./cut.mjs";
import { ask as askHandedOut, measure, meta } from "./handed-out.mjs";
import { ask as askWhole } from "./whole.mjs";
const ask = () => typeof import.meta.resolve("./x.mjs") + " " + typeof import.meta.url;
const all = () => [ask(), askCut(), askHandedOut(), measure() > 5, askWhole()].join(" | ");
console.log(all());
cut();
console.log(all());
Object.setPrototypeOf(meta, { url: 5 });
console.log(all(), measure());
