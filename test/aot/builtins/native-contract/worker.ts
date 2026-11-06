// One process of the test: bun --expose-internals worker.ts <request.json> <reports.jsonl>
// A native function may end the process or never return, so none is called in the process of the test.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { addLiveCandidates } from "../differential/live";
import { Realm } from "../differential/members";
import { Table } from "../differential/table-description";
import { checkTarget } from "./check-target";
import { addHostInstances } from "./host-instances";
import { collectTargets } from "./targets";

export type WorkerRequest = { filter: string; index: number; count: number; finished: string[] };

const [requestPath, reportsPath] = process.argv.slice(2);
const { filter, index, count, finished }: WorkerRequest = JSON.parse(readFileSync(requestPath, "utf8"));

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

const realm = new Realm(new Table(aotBuiltinEntries()));
await addLiveCandidates(realm);
await addHostInstances(realm);

const traceSet = process.env.AOT_NATIVE_CONTRACT_TRACE ? (set: string) => writeFileSync(`${reportsPath}.set`, set) : undefined;
const isFinished = new Set(finished);
const targets = collectTargets(realm, new RegExp(filter));
for (const [position, target] of targets.entries()) {
  if (position % count !== index || isFinished.has(target.name)) continue;
  writeFileSync(`${reportsPath}.current`, JSON.stringify(target.name));
  const report = "reason" in target ? target : await checkTarget(realm, target, traceSet);
  appendFileSync(reportsPath, JSON.stringify(report) + "\n");
}
writeFileSync(`${reportsPath}.current`, "null");
process.exit(0);
