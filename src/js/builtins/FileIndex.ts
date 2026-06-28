interface FileIndex {
  $pull(pattern, options): Promise<unknown[]>;
}

export function grep(this: FileIndex, pattern, options) {
  // Validate (and snapshot the candidate set) synchronously so bad arguments
  // and a closed index throw from `grep()` itself, not from the first `next()`.
  const matchesPromise = this.$pull(pattern, options);
  async function* iter() {
    yield* (await matchesPromise) || [];
  }
  return iter();
}
