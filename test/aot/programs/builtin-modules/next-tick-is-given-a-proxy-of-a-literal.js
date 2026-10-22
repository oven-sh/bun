// A compiled program describes an argument that a native function rejects without running script, so a Proxy is `[Object]` where plain Bun reads `constructor.name` through it: it has an .expected.txt.
const proxy = new Proxy({}, {});
try {
  process.nextTick(proxy);
} catch (error) {
  console.log(error.message);
}
