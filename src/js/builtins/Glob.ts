interface Glob {
  scan();
}

export function scanIter(this: Glob, opts) {
  async function* iter(glob, opts) {
    const theStrings = await glob.scan(opts);
    for (const path of theStrings) {
      yield path;
    }
  }
  return iter(this, opts);
}
