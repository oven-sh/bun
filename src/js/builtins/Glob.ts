interface Glob {
  $pull(opts);
  $resolveSync(opts);
}

export function scan(this: Glob, opts) {
  const valuesPromise = this.$pull(opts);
  async function* iter() {
    const values = (await valuesPromise) || [];
    yield* values;
  }
  return iter();
}

export function scanSync(this: Glob, opts) {
  const arr = this.$resolveSync(opts) || [];
  function* iter() {
    yield* arr;
  }
  return iter();
}
