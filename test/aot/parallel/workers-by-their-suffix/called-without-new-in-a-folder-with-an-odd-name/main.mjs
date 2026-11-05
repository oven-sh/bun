let said;
try {
  const { default: make } = await import("./it's an odd dir/job.mjs?worker");
  const worker = make();
  said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
  worker.terminate();
  said += " " + (worker instanceof Worker) + " " + make.length + " " + make.name;
} catch (e) { said = e.name; }
console.log(said);
