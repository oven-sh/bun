// A worker is handed arguments that are no texts. What its process.argv and process.execArgv hold is asked inside it.
function kinds(list) {
  let all = "";
  for (let i = 2; i < list.length; i++) all += `${typeof list[i]}:${list[i].length} `;
  return all;
}
if (Bun.isMainThread) {
  const run = options =>
    new Promise(done => {
      const worker = new Worker(new URL(import.meta.url), options);
      worker.onmessage = event => console.log(event.data);
      worker.onerror = event => (console.log("error"), event.preventDefault());
      worker.addEventListener("close", done);
    });
  await run({ argv: [1, 2.5, null, undefined, true, { toString: () => "an object" }, ["a", "b"], "--added"] });
  await run({ argv: [] });
  await run({ argv: ["--added"], execArgv: ["--smol"] });
} else {
  postMessage([kinds(process.argv), process.argv.length, process.argv.includes("--added"), process.argv.includes("1"), Array.isArray(process.execArgv), process.execArgv.length, process.execArgv.includes("--smol")].join(" | "));
}
