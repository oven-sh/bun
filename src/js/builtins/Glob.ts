interface Glob {
  $globScan(opts);
  $globScanSync(opts);
}

export function scan(this: Glob, opts) {
  const valuesPromise = this.$globScan(opts);
  async function* iter() {
    const values = (await valuesPromise) || [];
    yield* values;
  }
  return iter();
}

export function scanSync(this: Glob, opts) {
  const arr = this.$globScanSync(opts) || [];
  function* iter() {
    yield* arr;
  }
  return iter();
}
