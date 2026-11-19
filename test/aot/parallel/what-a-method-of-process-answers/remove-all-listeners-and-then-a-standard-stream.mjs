// As off-and-then-a-member-that-nothing-else-names.mjs: the answer is asked for a stream, and the stream for more than a write.
const held = process.removeAllListeners("madeUp");
console.log(typeof held.stdout.write, typeof held.stdout.cork, held.stderr.fd);
