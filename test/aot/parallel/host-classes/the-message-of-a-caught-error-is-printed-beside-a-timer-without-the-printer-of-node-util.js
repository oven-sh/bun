// What the run time throws is an object nobody knows, and so is its message. A timer has no way of its own to be printed, so the printer of node:util stays out.
// STATISTIC: ImageFunctionsEmitted <= 10
setTimeout(() => {}, 1);
try { null.x; } catch (e) { console.log(e.message); }
