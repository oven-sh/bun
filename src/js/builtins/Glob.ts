type Glob = import("bun").Glob;

$overriddenName = "";
export function scan(this: Glob, opts?: Parameters<Glob["$globScan"]>[0]) {
  const valuesPromise = this.$globScan(opts);
  async function* iter() {
    const values = (await valuesPromise) || [];
    yield* values;
  }
  return iter();
}

$overriddenName = "";
export function scanSync(this: Glob, opts?: Parameters<Glob["$globScan"]>[0]) {
  const arr = this.$globScanSync(opts) || [];
  function* iter() {
    yield* arr;
  }
  return iter();
}
