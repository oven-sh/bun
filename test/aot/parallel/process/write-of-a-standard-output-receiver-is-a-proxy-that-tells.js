const asked = [];
const receiver = new Proxy({}, { get: (target, key) => (asked.push(String(key)), undefined) });
try {
  console.log(process.stdout.write.call(receiver, "x\n"));
} catch (error) {
  console.log(error.name);
}
console.log(asked.join());
