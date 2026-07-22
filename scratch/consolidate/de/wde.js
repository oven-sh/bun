const { Worker, isMainThread } = require('worker_threads');
if (!isMainThread) { process._debugEnd(); } else {
  const wk = new Worker(__filename);
  wk.on('exit', () => { console.log('worker gone'); process.exitCode = 55; });
}
