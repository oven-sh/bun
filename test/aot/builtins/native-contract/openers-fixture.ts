// Prints why an opener made nothing, as JSON: bun --expose-internals openers-fixture.ts
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { openersOfWhatTheLibraryHolds } from "../differential/held-by-the-library";
import { candidatesForTheirClass } from "../differential/instances";
import { addLiveCandidates } from "../differential/live";
import { Realm } from "../differential/members";
import { Table } from "../differential/table-description";
import { addHostInstances } from "./host-instances";

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

const realm = new Realm(new Table(aotBuiltinEntries()));
await addLiveCandidates(realm);
console.log(JSON.stringify(await addHostInstances(realm, candidatesForTheirClass, openersOfWhatTheLibraryHolds)));
process.exit(0);
