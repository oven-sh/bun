import * as b from "bun-builtins-table";

const startedAsServer = { read: "PassedTo", builtin: "Bun.serve", argument: 0 } satisfies b.HostReadUse;
const awaitedAsThenable = { read: "Called" } satisfies b.HostReadUse;

export default b.declarations(
  b.hostRead("EntryPoint", "default", startedAsServer),
  b.hostRead("EntryPoint", "then", awaitedAsThenable),
  b.hostRead("Worker", "default", startedAsServer),
  b.hostRead("Worker", "then", awaitedAsThenable),
  b.hostRead("Preload", "default", { read: "Inspected" }),
  b.hostRead("Preload", "then", awaitedAsThenable),
  b.hostRead("Plugin", "default", { read: "PassedTo", builtin: "Bun.plugin", argument: 0 }),
  b.hostRead("Plugin", "then", awaitedAsThenable),
);
