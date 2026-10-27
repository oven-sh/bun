// The main thread starts Workers in waves, all at once or one behind the other, and hands each a piece of work: objects of very many shapes read
// by name, lists, texts, maps, buffers, JSON, a Worker of its own. Some are terminated, some end by themselves, some throw. Every Worker answers
// with a sum that hangs on its work alone; a Worker that could not be started is written down as refused. The program is meant to be run
// within a limit on the address space of the process (ulimit -v): what starts answers as without a limit.
import type { Random } from "./random";

const works = [
  `shapes(size) {\nlet total = 0;\nconst made = [];\nfor (let index = 0; index < size; index++) {\nconst object = {};\nobject["a" + (index % 977)] = index;\nobject["b" + index] = 1;\nmade.push(object);\n}\nfor (let index = 0; index < size; index++) total += made[index]["a" + (index % 977)] + made[index]["b" + index];\nreturn total;\n}`,
  `names(size) {\nlet total = 0;\nconst object = {};\nfor (let index = 0; index < size; index++) object["k" + index] = index;\nfor (const key in object) total += object[key];\nfor (let index = 0; index < size; index += 3) delete object["k" + index];\nreturn total + Object.keys(object).length;\n}`,
  `classes(size) {\nlet total = 0;\nfor (let index = 0; index < size / 50; index++) {\nconst Made = class {\nconstructor() {\nthis["f" + index] = index;\n}\nget ["g" + index]() {\nreturn 1;\n}\n};\nconst made = new Made();\ntotal += made["f" + index] + made["g" + index];\n}\nreturn total;\n}`,
  `lists(size) {\nconst list = [];\nfor (let index = 0; index < size * 4; index++) list.push(index % 2 ? index : index + 0.5);\nreturn list.map(value => value * 2).filter(value => value % 3 < 2).reduce((sum, value) => sum + value, 0);\n}`,
  `texts(size) {\nlet text = "";\nfor (let index = 0; index < size; index++) text += String.fromCharCode(97 + (index % 26)) + index;\nreturn text.length + text.split("a").length + text.toUpperCase().indexOf("Z9");\n}`,
  `maps(size) {\nconst map = new Map();\nconst set = new Set();\nfor (let index = 0; index < size; index++) {\nmap.set("k" + index, { index });\nset.add(index * 7);\n}\nlet total = 0;\nfor (const [, value] of map) total += value.index;\nreturn total + set.size;\n}`,
  `buffers(size) {\nlet total = 0;\nfor (let turn = 0; turn < 8; turn++) {\nconst bytes = new Uint8Array(size * 16);\nbytes.fill(turn + 1);\ntotal += bytes[size] + new Float64Array(bytes.buffer, 0, 8).length;\n}\nreturn total;\n}`,
  `json(size) {\nconst text = JSON.stringify(Array.from({ length: size / 4 }, (_, index) => ({ id: index, name: "n" + index, tags: [index, "t"] })));\nreturn text.length + JSON.parse(text).reduce((sum, row) => sum + row.id + row.tags.length, 0);\n}`,
  `garbage(size) {\nlet kept = null;\nfor (let index = 0; index < size * 20; index++) kept = { previous: index % 64 ? kept : null, index };\nBun.gc(true);\nreturn kept.index;\n}`,
  `patterns(size) {\nlet total = 0;\nfor (let index = 0; index < size / 100; index++) total += new RegExp("(a" + index + ")|b+").exec("xbbb" + index)[0].length;\nreturn total;\n}`,
] as const;

export function generate(random: Random): string {
  const count = random.pick([1, 2, 3, 4, 6, 8, 8, 12, 16, 24]);
  const wave = random.pick([1, 2, 4, count, count]);
  const kinds = works.map(work => work.slice(0, work.indexOf("(")));
  const jobs = Array.from({ length: count }, (_, id) => ({
    id,
    kind: random.pick(kinds),
    size: random.pick([100, 1000, 5000, 20000, count > 8 ? 5000 : 60000]),
    child: random.chance(0.12),
    end: random.weighted([
      [6, "stays"],
      [2, "exits"],
      [1, "closes"],
      [1, "throws"],
    ] as const),
    isTerminated: random.chance(0.3),
  }));
  const usesNode = random.chance(0.3);
  return `${usesNode ? `import { Worker as NodeWorker, isMainThread, parentPort, workerData } from "node:worker_threads";\n` : ""}const works = {
${works.join(",\n")},
};
const told = run => {
try {
return String(run());
} catch (error) {
return "threw " + error.name;
}
};
function startWorker(job, answer) {
let worker;
let isAnswered = false;
const once = text => {
if (isAnswered) return;
isAnswered = true;
if (worker && job.end === "throws") worker.postMessage("go on");
answer(text, worker);
};
try {
${
  usesNode
    ? `worker = new NodeWorker(new URL(import.meta.url), { workerData: job });\nworker.on("message", once);\nworker.on("error", error => once(error instanceof TypeError ? "refused" : "failed " + error.name));`
    : `worker = new Worker(new URL(import.meta.url));\nworker.onmessage = event => once(event.data);\nworker.onerror = event => {\nevent.preventDefault?.();\nonce(event.message.startsWith("TypeError: Failed to spawn") ? "refused" : "failed");\n};\nworker.postMessage(job);`
}
} catch (error) {
once(error instanceof TypeError ? "refused" : "threw " + error.name);
}
}
function work(job, post) {
const own = job.kind + " " + job.size + " " + told(() => works[job.kind](job.size));
const finish = text => {
post(text);
if (job.end === "exits") process.exit(0);
if (job.end === "closes") ${usesNode ? "parentPort.close()" : "self.close()"};
if (job.end === "throws") ${usesNode ? `parentPort.once("message", () => {` : `self.onmessage = () => {`}
throw new Error("behind the answer");
}${usesNode ? ")" : ""};
if (job.end === "stays") setInterval(() => {}, 1000);
};
if (!job.child) return finish(own);
startWorker({ ...job, child: false, end: "stays", kind: "lists", size: 500 }, (text, child) => {
child?.terminate();
finish(own + " and " + text);
});
}
if (${usesNode ? "isMainThread" : "Bun.isMainThread"}) {
const jobs = ${JSON.stringify(jobs)};
const lines = [];
const started = [];
for (let first = 0; first < jobs.length; first += ${wave}) {
await Promise.all(
jobs.slice(first, first + ${wave}).map(
job =>
new Promise(resolve =>
startWorker(job, (text, worker) => {
lines[job.id] = job.id + ": " + text;
if (worker && job.isTerminated) worker.terminate();
else if (worker) started.push(worker);
resolve();
}),
),
),
);
}
console.log(lines.join("\\n"));
process.exit(0);
} else {
${usesNode ? `work(workerData, text => parentPort.postMessage(text));` : `self.onmessage = event => work(event.data, text => postMessage(text));`}
}
`;
}
