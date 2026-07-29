interface Glob {
  $pull(opts);
  $resolveSync(opts);
}

export function scan(this: Glob, opts) {
  const scanner = this.$pull(opts);
  async function* iter() {
    if (!scanner) return;
    try {
      let chunk;
      while ((chunk = scanner.pull()) !== null) {
        chunk = await chunk;
        if (chunk === null) return;
        yield* chunk;
      }
    } finally {
      scanner.close();
    }
  }
  return iter();
}

export function scanSync(this: Glob, opts) {
  const scanner = this.$resolveSync(opts);
  function* iter() {
    if (!scanner) return;
    try {
      let value;
      while ((value = scanner.nextSync()) !== null) {
        yield value;
      }
    } finally {
      scanner.close();
    }
  }
  return iter();
}
