interface Glob {
  __scan(opts);
  __scanSync(opts);
}

export function scan(this: Glob, opts) {
  const valuesPromise = this.__scan(opts);
  async function* iter() {
    const values = (await valuesPromise) || [];
    yield* values;
  }
  return iter();
}

export function scanSync(this: Glob, opts) {
  const arr = this.__scanSync(opts) || [];
  function* iter() {
    yield* arr;
  }
  return iter();
}
