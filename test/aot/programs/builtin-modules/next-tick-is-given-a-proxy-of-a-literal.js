// A compiled program describes an argument that a native function rejects without running script. A Proxy whose handler has no `get` hands the read of `constructor` on to its target, so it is described as plain Bun describes it.
const proxy = new Proxy({}, {});
try {
  process.nextTick(proxy);
} catch (error) {
  console.log(error.message);
}
