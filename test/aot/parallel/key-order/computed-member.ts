// A literal with a member that is computed behind its allocation lists its keys as they are written.
function hostName(): string {
  return "localhost";
}
function make(port: number) {
  return { port, host: hostName() };
}
console.log(Object.keys(make(1)).join(), JSON.stringify(Object.entries(make(2))), JSON.stringify({ ...make(3) }));
for (const key in make(4)) console.log(key);
