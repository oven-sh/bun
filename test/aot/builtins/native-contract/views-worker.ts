// One process of the test: bun --expose-internals views-worker.ts <request.json> <reports.jsonl>
// As worker.ts, for the overloads of which the table says that they leave the storage of views alone.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";
import { addLiveCandidates } from "../differential/live";
import { Realm } from "../differential/members";
import { Table } from "../differential/table-description";
import { checkViews } from "./check-views";
import { addHostInstances } from "./host-instances";
import { setUpPrefix } from "./run-workers";
import { collectTargetsQuietForViews } from "./targets";
import type { WorkerRequest } from "./worker";

const [requestPath, reportsPath] = process.argv.slice(2);
const { filter, index, count, finished, toldQuiet }: WorkerRequest = JSON.parse(readFileSync(requestPath, "utf8"));

const reports = openSync(reportsPath, "a");
const current = openSync(`${reportsPath}.current`, "r+");
function sayCurrent(name: string | null): void {
  const text = JSON.stringify(name);
  ftruncateSync(current, writeSync(current, text, 0));
}

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

sayCurrent(`${setUpPrefix}table`);
const realm = new Realm(new Table(aotBuiltinEntries()));
sayCurrent(`${setUpPrefix}live candidates`);
await addLiveCandidates(realm);
sayCurrent(`${setUpPrefix}host instances`);
await addHostInstances(realm);
sayCurrent(`${setUpPrefix}targets`);

const isFinished = new Set(finished);
const targets = collectTargetsQuietForViews(realm, new RegExp(filter), toldQuiet === undefined ? undefined : new RegExp(toldQuiet));
for (const [position, target] of targets.entries()) {
  if (position % count !== index || isFinished.has(target.name)) continue;
  sayCurrent(target.name);
  const report = "reason" in target ? target : await checkViews(realm.table, target);
  writeSync(reports, JSON.stringify(report) + "\n");
}
sayCurrent(null);
process.exit(0);
