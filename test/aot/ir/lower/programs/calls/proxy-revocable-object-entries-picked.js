// RUN: lower
// OPTIONS: builtin-modules

// Proxy revocable or object entries is picked by a condition and called.
for (const first of [process.argv.length < 99, process.argv.length > 99]) {
  const answer = (first ? Proxy.revocable : Object.entries)({}, {});
  console.log(answer.length, typeof answer.revoke);
}
