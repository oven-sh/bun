console.log("imports-back runs");
async function awaitsRunning() {
  const names = await import("./running.mjs");
  console.log("behind the await of import of running, ended:", names.ended);
}
awaitsRunning();
