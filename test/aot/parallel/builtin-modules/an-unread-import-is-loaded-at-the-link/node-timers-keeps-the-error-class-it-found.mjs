// The program puts a class of its own in the place of `Error`. node:timers was loaded where the file was linked, before that: what it throws is
// of the class that was there then. A build that sees the store runs the module at the link too.
// COUNT: operation:operationAOTRequireModule >= 1
import timers from "node:timers";
const Built = Error;
globalThis.Error = class Mine extends Built {};
try {
  timers.unenroll({});
} catch (error) {
  console.log(error instanceof globalThis.Error, error instanceof Built, error.name);
}
