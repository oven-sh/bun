// A literal of another file that nothing changes: its members are known where they are read. Beside it stand literals that are changed by name, under a key, by a built-in and by a file
// that runs later: their members are read.
// STATISTIC: NarrowConstantVariablesChanges >= 1
import { fixed, changedByName, changedByKey, changedByBuiltin, changedLater, make } from "./declarations.mjs";
console.log(fixed.port + 1, fixed.name + "!", fixed.nested.deep ? "deep" : "shallow", fixed.half, Object.is(fixed.zero, -0), fixed.none, fixed.missing);
console.log(changedByName.port, changedByKey.port, changedByBuiltin.port, changedLater.port);
changedByName.port = 81;
changedByKey[process.argv.length > 99 ? "name" : "port"] = 82;
Object.assign(changedByBuiltin, { port: 83 });
await import("./later.mjs");
console.log(changedByName.port, changedByKey.port, changedByBuiltin.port, changedLater.port);
const [first, second] = [make(), make()];
second.count++;
console.log(first.count, first.kind, second.count, second.kind);
