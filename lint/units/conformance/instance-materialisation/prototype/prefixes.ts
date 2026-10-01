// Research prototype: removeTestPathPrefixes (tsbaseline/util.go:44), a scan from the left that takes the first old string that matches.
const pairs: [string, string, string][] = [
  ["/.ts/", "", "/"],
  ["/.lib/", "", "/"],
  ["/.src/", "", "/"],
  ["bundled:///libs/", "", "/"],
  ["file:///./ts/", "file:///", "file:///"],
  ["file:///./lib/", "file:///", "file:///"],
  ["file:///./src/", "file:///", "file:///"],
];
export function removeTestPathPrefixes(text: string, retainTrailingDirectorySeparator: boolean): string {
  let out = "";
  let i = 0;
  let copied = 0;
  outer: while (i < text.length) {
    const ch = text.charCodeAt(i);
    // every old string starts with "/", "b" or "f"
    if (ch === 0x2f || ch === 0x62 || ch === 0x66) {
      for (const [old, plain, trailing] of pairs) {
        if (text.startsWith(old, i)) {
          out += text.slice(copied, i) + (retainTrailingDirectorySeparator ? trailing : plain);
          i += old.length;
          copied = i;
          continue outer;
        }
      }
    }
    i++;
  }
  return out + text.slice(copied);
}
