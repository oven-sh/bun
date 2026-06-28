interface FileIndex {
  $pull(pattern, options): Promise<unknown[]>;
  /**
   * Native candidate snapshot for RegExp grep (see FileIndex.classes.ts).
   * `paths` are relative to the `cwd` option; `prefix` is that cwd ("" or
   * "dir/"), which `$read` needs to locate a candidate from the root.
   * `maxFileSize`, `limit` and `context` are the VALIDATED options — the
   * shim never reads the user's options object itself, so both engines see
   * one parse (and option getters run exactly once).
   */
  $paths(options): { paths: string[]; prefix: string; maxFileSize: number; limit: number; context: number };
  /**
   * Guarded native read of one candidate, off the JS thread: the same
   * `open(O_NOFOLLOW|O_NONBLOCK)` + `fstat(fd)` the literal worker uses, so
   * a candidate swapped for a symlink is never read through and one swapped
   * for a writer-less FIFO never blocks. Resolves `null` for a vanished,
   * non-regular, oversized, or binary candidate.
   */
  $read(relPath: string, maxFileSize: number): Promise<string | null>;
  /** `true` once `close()` has run. Never throws. */
  $closeRequested(): boolean;
}

export function grep(this: FileIndex, pattern, options) {
  const index = this;
  // Validate (and snapshot the candidate set) synchronously so bad arguments
  // and a closed index throw from `grep()` itself, not from the first `next()`.
  if ($isRegExpObject(pattern)) {
    const { paths, prefix, maxFileSize, limit, context } = index.$paths(options);
    // A fresh global, non-sticky copy: caller `lastIndex` state can neither
    // corrupt the search nor be mutated by it. The flags are rebuilt from
    // the per-flag native getters and `new RegExp(re, flags)` reads `re`'s
    // [[OriginalSource]] internal slot, so neither the (user-overridable)
    // `flags` nor `source` accessor is ever invoked.
    let flags = "g";
    if (pattern.hasIndices) flags += "d";
    if (pattern.ignoreCase) flags += "i";
    if (pattern.multiline) flags += "m";
    if (pattern.dotAll) flags += "s";
    if (pattern.unicode) flags += "u";
    if (pattern.unicodeSets) flags += "v";
    const re = new RegExp(pattern, flags);

    /** Files read concurrently per batch. */
    const READ_CONCURRENCY = 16;

    function readCandidate(this: FileIndex, relPath: string): Promise<string | null> {
      // The guarded native read (`__grepRead`): admission (still a regular
      // file, within `maxFileSize`, not binary) is decided from the OPENED
      // fd on the thread pool, mirroring the literal worker. A candidate
      // that vanished or was swapped for a symlink/FIFO since the snapshot
      // resolves `null` and is simply not searched. `relPath` is relative
      // to the grep's `cwd`; `$read` wants it relative to the root.
      return this.$read(prefix + relPath, maxFileSize);
    }
    // `\n`-split `text` into lines with any trailing `\r` removed, dropping
    // the empty slot after a trailing newline. `$charCodeAt`/`$substr` are
    // JSC's private-name aliases of the original String.prototype methods,
    // so a tampered `String.prototype.split`/`slice` cannot affect this.
    function splitLines(text: string): string[] {
      const lines: string[] = [];
      const n: number = text.length;
      let start = 0;
      for (let i = 0; i < n; i++) {
        if (text.$charCodeAt(i) === 0x0a) {
          let end = i;
          if (end > start && text.$charCodeAt(end - 1) === 0x0d) end--;
          $arrayPush(lines, text.$substr(start, end - start));
          start = i + 1;
        }
      }
      if (start < n) {
        let end = n;
        if (end > start && text.$charCodeAt(end - 1) === 0x0d) end--;
        $arrayPush(lines, text.$substr(start, end - start));
      }
      return lines;
    }
    function contextLines(lines: string[], from: number, to: number): string[] {
      const out: string[] = [];
      for (let i = from < 0 ? 0 : from; i < to && i < lines.length; i++) $arrayPush(out, lines[i]);
      return out;
    }

    // Reads each candidate on the JS thread (bounded concurrency) and runs the
    // RegExp per line. Same hit shape, ordering, and option semantics as the
    // native literal fast path.
    async function* regExpIter() {
      let emitted = 0;
      for (let i = 0; i < paths.length && emitted < limit; i += READ_CONCURRENCY) {
        if (index.$closeRequested()) return;
        const batchEnd = $min(i + READ_CONCURRENCY, paths.length);
        // Start every read in the batch, then consume them in order: the
        // reads overlap without `Promise.all` (whose `then`/iteration
        // protocol is user-observable).
        const texts: Promise<string | null>[] = [];
        for (let j = i; j < batchEnd; j++) $arrayPush(texts, readCandidate.$call(index, paths[j]));
        for (let j = i; j < batchEnd && emitted < limit; j++) {
          const text = await texts[j - i];
          if (text === null) continue;
          const path = paths[j];
          const lines = splitLines(text);
          for (let k = 0; k < lines.length && emitted < limit; k++) {
            const lineText = lines[k];
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(lineText)) !== null) {
              if (index.$closeRequested()) return;
              if (context > 0) {
                yield {
                  path,
                  line: k + 1,
                  column: m.index + 1,
                  lineText,
                  before: contextLines(lines, k - context, k),
                  after: contextLines(lines, k + 1, k + 1 + context),
                };
              } else {
                yield { path, line: k + 1, column: m.index + 1, lineText };
              }
              if (++emitted >= limit) return;
              // A zero-width match would otherwise loop forever at one index.
              if (m[0].length === 0) re.lastIndex++;
            }
          }
        }
      }
    }
    return regExpIter();
  }

  const matchesPromise = index.$pull(pattern, options);
  async function* iter() {
    const matches = (await matchesPromise) || [];
    for (let i = 0; i < matches.length; i++) {
      // An iterator obtained before `close()` stops instead of yielding
      // results from a closed index; the native promise already settled.
      if (index.$closeRequested()) return;
      yield matches[i];
    }
  }
  return iter();
}
