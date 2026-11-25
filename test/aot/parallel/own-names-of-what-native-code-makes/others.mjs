import { PerformanceObserver, performance } from "node:perf_hooks";
const said = [];
const step = new Intl.Segmenter("en", { granularity: "word" }).segment("a b")[Symbol.iterator]().next();
said.push("segment step own: " + Object.getOwnPropertyNames(step).sort().join(), "value own: " + Object.getOwnPropertyNames(step.value).sort().join(), [step.done, step.value.segment, step.value.index, step.value.input, step.value.isWordLike].join());
const list = await new Promise((resolve) => { const observer = new PerformanceObserver((entries) => { observer.disconnect(); resolve(entries); }); observer.observe({ entryTypes: ["mark"] }); performance.mark("m"); });
said.push("entry list own: " + Object.getOwnPropertyNames(list).sort().join(), [typeof list.getEntries, typeof list.getEntriesByName, typeof list.getEntriesByType, list.getEntries().length, list.getEntries()[0].name].join());
const entry = list.getEntries()[0]; said.push("entry own: " + Object.getOwnPropertyNames(entry).sort().join(), [entry.entryType, typeof entry.startTime, typeof entry.duration, typeof entry.detail, typeof entry.toJSON].join());
console.log(said.join("\n"));
