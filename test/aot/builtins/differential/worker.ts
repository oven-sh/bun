// One process of the differential test: bun --expose-internals worker.ts <request.json> <reports.jsonl>
// A built-in may end the process, never return, or leave an exception for the event loop, so none is called in the process of the test.
import "./describe-values-without-running-code";
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { callsOf, checkCall, emptyReport, type CallReport } from "./check-call";
import { addHostInstances } from "../native-contract/host-instances";
import { openersOfWhatTheLibraryHolds } from "./held-by-the-library";
import { candidatesForTheirClass } from "./instances";
import { addLiveCandidates } from "./live";
import { Realm } from "./members";
import { Table, type CallMode } from "./table-description";

export type WorkerRequest = { tablePath: string | null; calls: [entry: string, mode: CallMode][] };
// The contents of `<reports.jsonl>.current`: the call in progress, why no call has started yet, or null once every call is done.
export type WorkerNote = [entry: string, mode: CallMode] | { notStarted: string } | null;
// `failure`: the test itself threw, which says nothing about the built-in.
export type WorkerReport = CallReport & { entry: string; failure?: string };

const [requestPath, reportsPath] = process.argv.slice(2);
const { tablePath, calls }: WorkerRequest = JSON.parse(readFileSync(requestPath, "utf8"));

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

const table = new Table(tablePath === null ? aotBuiltinEntries() : JSON.parse(readFileSync(tablePath, "utf8")));
const realm = new Realm(table);
try {
  await addLiveCandidates(realm);
  const failures = await addHostInstances(realm, candidatesForTheirClass, openersOfWhatTheLibraryHolds);
  if (failures.length > 0) throw new Error(failures.join("\n"));
} catch (error) {
  // The handlers above would swallow this and the process would exit quietly without making any of its calls.
  writeFileSync(`${reportsPath}.current`, JSON.stringify({ notStarted: Bun.inspect(error) } satisfies WorkerNote));
  process.exit(1);
}

// What native code holds for an object that is no longer used is let go by a collection, and the engine does not know how much that is.
const callsPerCollection = 100;

for (const [index, [token, mode]] of calls.entries()) {
  if (index % callsPerCollection === callsPerCollection - 1) Bun.gc(true);
  const entry = table.entries.get(token);
  const call = entry && callsOf(realm, entry).find(other => other.mode === mode);
  if (!call) continue;
  writeFileSync(`${reportsPath}.current`, JSON.stringify([token, mode]));
  let report: WorkerReport;
  try {
    report = { ...(await checkCall(realm, call)), entry: token };
  } catch (error) {
    // Unhandled, it would end this process quietly: the handlers above are for what the built-ins leave behind.
    report = { ...emptyReport(call), entry: token, failure: Bun.inspect(error) };
  }
  appendFileSync(reportsPath, JSON.stringify(report) + "\n");
  // Whatever made the test throw may still be there: the calls behind this one get a new process.
  if (report.failure !== undefined) process.exit(1);
}
writeFileSync(`${reportsPath}.current`, "null");
process.exit(0);
