for (const load of [() => import("./job.cjs?worker"), () => import("./job.js?worker")]) {
  let said;
  try {
    const { default: Made } = await load();
    const worker = new Made();
    said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
    worker.terminate();
  } catch (e) { said = e.name; }
  console.log(said);
}
