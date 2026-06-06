// Second-instance probe: tries to acquire the single-instance lock and prints
// the result. The parent test holds the lock, so this must print "false".
import { app } from "../../src/index.ts";

const got = app.requestSingleInstanceLock();
console.log(JSON.stringify({ got, has: app.hasSingleInstanceLock() }));
process.exit(0);
