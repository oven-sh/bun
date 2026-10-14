// trees/fuse/measure.ts <searches> <items>: a measure, not a gate: a list of objects with three keys is indexed once and searched; prints what was found, so that two builds can be seen to do the same work.
import Fuse from "fuse.js";
const searches = Number(process.argv[2] ?? 50), items = Number(process.argv[3] ?? 2000);
const list = Array.from({ length: items }, (_, i) => ({ name: ["open", "close", "toggle", "show", "hide", "run", "list"][i % 7] + " " + (i * 7919 % 1000).toString(36) + " " + ["panel", "file", "terminal", "settings", "session"][i % 5], description: "Does the thing number " + i + " with the " + ["editor", "project", "model", "history"][i % 4] + " and then some more words to search in", aliases: i % 3 ? [] : ["a" + i, "alias " + (i % 11)] }));
const fuse = new Fuse(list, { keys: [{ name: "name", weight: 3 }, { name: "aliases", weight: 2 }, "description"], includeScore: true, threshold: 0.4 });
let found = 0, hash = 0;
const patterns = ["open file", "sesion", "toggle term", "history", "alias 7", "run", "setings panel", "thing number 12", "close", "modl"];
for (let s = 0; s < searches; s++) { const r = fuse.search(patterns[s % patterns.length]!); found += r.length; for (const x of r) hash = (Math.imul(hash, 31) + x.refIndex) | 0; }
console.error("SAME WORK: " + items + " items, " + searches + " searches: " + found + " results, " + hash);
