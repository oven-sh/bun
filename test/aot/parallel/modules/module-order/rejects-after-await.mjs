console.log("rejects-after-await starts");
import("./rejected-parent-b.mjs").catch(error => console.log("rejected-parent-b rejects", error.constructor.name));
import("./rejected-parent-a.mjs").catch(error => console.log("rejected-parent-a rejects", error.constructor.name));
await new Promise(resolve => setTimeout(resolve));
throw new RangeError("in rejects-after-await");
