for (const first of [process.argv.length < 99, process.argv.length > 99]) {
  const answer = (first ? Proxy.revocable : Object.entries)({}, {});
  console.log(answer.length, typeof answer.revoke);
}
