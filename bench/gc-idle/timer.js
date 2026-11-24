// A process that wakes once a second and allocates, like a server that gets one request a second. The argument is the
// run time in milliseconds.
setInterval(() => {
  globalThis.last = { at: Date.now() };
}, 1000);
setTimeout(() => process.exit(0), Number(process.argv[2] ?? 12000));
