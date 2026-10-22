// One process of the differential test: bun --expose-internals worker.ts <request.json> <reports.jsonl>
// A built-in may end the process, never return, or leave an exception for the event loop, so none is called in the process of the test.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { callsOf, checkCall, type CallReport } from "./check-call";
import { addLiveCandidates } from "./live";
import { Realm } from "./members";
import { Table, type CallMode } from "./table-description";

export type WorkerRequest = { tablePath: string | null; calls: [entry: string, mode: CallMode][] };
export type WorkerReport = CallReport & { entry: string };

const [requestPath, reportsPath] = process.argv.slice(2);
const { tablePath, calls }: WorkerRequest = JSON.parse(readFileSync(requestPath, "utf8"));

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

const table = new Table(tablePath === null ? aotBuiltinEntries() : JSON.parse(readFileSync(tablePath, "utf8")));
const realm = new Realm(table);
await addLiveCandidates(realm);

for (const [token, mode] of calls) {
  const entry = table.entries.get(token);
  const call = entry && callsOf(realm, entry).find(other => other.mode === mode);
  if (!call) continue;
  writeFileSync(`${reportsPath}.current`, JSON.stringify([token, mode]));
  const report: WorkerReport = { ...(await checkCall(realm, call)), entry: token };
  appendFileSync(reportsPath, JSON.stringify(report) + "\n");
}
writeFileSync(`${reportsPath}.current`, "null");
process.exit(0);
