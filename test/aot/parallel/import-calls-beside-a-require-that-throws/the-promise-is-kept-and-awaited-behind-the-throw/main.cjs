// the promise of import() is kept, require() throws into a handler, and the promise is awaited behind that
const kept = import("./flaky.cjs");
try { require("./flaky.cjs"); } catch (error) { console.log("caught:", error.message); }
(async () => { try { console.log("imported:", (await kept).default.value); } catch (error) { console.log("rejected:", error.message); } })();
