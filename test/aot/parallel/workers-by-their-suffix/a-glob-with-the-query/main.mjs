const found = import.meta.glob("./job*.mjs", { query: "?worker" });
for (const [path, load] of Object.entries(found)) {
  const { default: Made } = await load();
  const worker = new Made();
  const said = await new Promise((resolve) => { worker.onmessage = (event) => resolve("says " + event.data); worker.onerror = () => resolve("fails"); });
  worker.terminate();
  console.log(path, said);
}
