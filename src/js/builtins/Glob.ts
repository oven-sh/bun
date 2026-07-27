interface GlobScanHandle {
  $pull(): Promise<string[] | null>;
  $resolveSync(): string[] | null;
  $close(): void;
}

interface Glob {
  $pull(opts): GlobScanHandle | undefined;
  $resolveSync(opts): GlobScanHandle | undefined;
}

export function scan(this: Glob, opts) {
  const handle = this.$pull(opts);
  async function* iter() {
    if (!handle) return;
    try {
      let batch: string[] | null;
      while ((batch = await handle.$pull())) {
        yield* batch;
      }
    } finally {
      handle.$close();
    }
  }
  return iter();
}

export function scanSync(this: Glob, opts) {
  const handle = this.$resolveSync(opts);
  function* iter() {
    if (!handle) return;
    try {
      let batch: string[] | null;
      while ((batch = handle.$resolveSync())) {
        yield* batch;
      }
    } finally {
      handle.$close();
    }
  }
  return iter();
}
