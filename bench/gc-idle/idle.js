// A process that waits and does nothing else. The argument is the wait in milliseconds.
setTimeout(() => {}, Number(process.argv[2] ?? 12000));
