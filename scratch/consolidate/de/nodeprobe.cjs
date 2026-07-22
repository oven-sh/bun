const { Worker, isMainThread } = require('worker_threads');
if (!isMainThread) {
  console.log('worker typeof:', typeof process._debugEnd);
  process._debugEnd();
  console.log('worker called ok');
} else {
  const w = new Worker(__filename);
  w.on('exit', c => console.log('exit', c));
}
