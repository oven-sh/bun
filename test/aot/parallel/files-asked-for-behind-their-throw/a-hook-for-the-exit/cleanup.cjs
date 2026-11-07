globalThis.atExit.push(() => {
  try { const store = require("./store.cjs"); console.log(globalThis.runs, store.early, store.late); }
  catch (error) { console.log("again", error.message); }
});
