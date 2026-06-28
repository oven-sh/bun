interface FileIndex {
  readonly root: string;
  $pull(pattern, options): Promise<unknown[]>;
  /** Native candidate snapshot for RegExp grep (see FileIndex.classes.ts). */
  $paths(options): string[];
  /** `true` once `close()` has run. Never throws. */
  $closeRequested(): boolean;
}

export function grep(this: FileIndex, pattern, options) {
  const index = this;
  // Validate (and snapshot the candidate set) synchronously so bad arguments
  // and a closed index throw from `grep()` itself, not from the first `next()`.
  if ($isRegExpObject(pattern)) {
    const paths: string[] = index.$paths(options);
    const root: string = index.root;
    // `$paths` already range-validated both; `??` only normalizes absence.
    const limit: number = options?.limit ?? Infinity;
    const context: number = options?.context ?? 0;
    // A fresh global, non-sticky copy: caller `lastIndex` state can neither
    // corrupt the search nor be mutated by it.
    let flags: string = pattern.flags.replaceAll("y", "");
    if (!flags.includes("g")) flags += "g";
    const re = new RegExp(pattern.source, flags);

    /** Files read concurrently per batch. */
    const READ_CONCURRENCY = 16;
    /**
     * A NUL within the first 8 KiB marks a file binary; mirrors the native
     * literal path's window (`bun_file_index::grep_file`).
     */
    const BINARY_SNIFF_LEN = 8192;

    async function readCandidate(this: string, relPath: string): Promise<string | null> {
      // A candidate that vanished (or became unreadable) since the snapshot
      // is simply not searched, exactly like the native literal path.
      try {
        return await Bun.file(this + "/" + relPath).text();
      } catch {
        return null;
      }
    }
    function stripCR(line: string): string {
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    }
    function contextLines(lines: string[], from: number, to: number): string[] {
      const out: string[] = [];
      for (let i = from < 0 ? 0 : from; i < to && i < lines.length; i++) out.push(stripCR(lines[i]));
      return out;
    }

    // Reads each candidate on the JS thread (bounded concurrency) and runs the
    // RegExp per line. Same hit shape, ordering, and option semantics as the
    // native literal fast path.
    async function* regExpIter() {
      let emitted = 0;
      for (let i = 0; i < paths.length && emitted < limit; i += READ_CONCURRENCY) {
        if (index.$closeRequested()) return;
        const batch = paths.slice(i, i + READ_CONCURRENCY);
        const texts: (string | null)[] = await Promise.all(batch.map(readCandidate, root));
        for (let j = 0; j < batch.length && emitted < limit; j++) {
          const text = texts[j];
          if (text === null) continue;
          const nul = text.indexOf("\0");
          if (nul !== -1 && nul < BINARY_SNIFF_LEN) continue;
          const path = batch[j];
          const lines = text.split("\n");
          // The element after a trailing newline is not a line.
          if (lines.length !== 0 && lines[lines.length - 1] === "") lines.pop();
          for (let k = 0; k < lines.length && emitted < limit; k++) {
            const lineText = stripCR(lines[k]);
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
