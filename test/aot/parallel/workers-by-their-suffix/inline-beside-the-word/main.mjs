let said;
try {
  const { default: Made } = await import("./job.mjs?worker&inline");
  const worker = new Made();
  said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
  worker.terminate();
} catch (e) { said = e.name; }
console.log(said);
