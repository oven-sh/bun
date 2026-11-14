let ended = 0;
for (let turn = 0; turn < 40; turn++) {
  const worker = new Worker("./job.cjs");
  await new Promise(resolve => worker.addEventListener("message", resolve));
  worker.terminate();
  ended++;
}
console.log(ended, "ended");
