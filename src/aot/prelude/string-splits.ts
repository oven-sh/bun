// What a program reads off `text.split(separator)` where it needs no list.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";

// text.split(separator).pop(), where the separator is not empty.
// In "aaa" split finds "aa" once, at the start, and a search from the end finds it one further on. So the separators are found as split finds them.
$visibility = "Private";
export function lastPieceOfSplit(text: string, separator: string): string {
  const step = separator.length;
  let start = 0;
  for (let found = text.indexOf(separator); found >= 0; found = text.indexOf(separator, start))
    start = (found + step) | 0;
  return text.substring(start);
}

// text.split(separator).length, where the separator is not empty.
$visibility = "Private";
export function numberOfPiecesOfSplit(text: string, separator: string): number {
  const step = separator.length;
  let count = 1;
  for (let found = text.indexOf(separator); found >= 0; found = text.indexOf(separator, (found + step) | 0))
    count = (count + 1) >>> 0;
  return count;
}
