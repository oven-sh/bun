// In a loop, `first` is read for a constant, the constant decides a key, and `text[key] === ..` is tested. Nothing refers to itself: the build takes the program, as TypeScript 6 and 7.1 do.
function count(lines: string[], width: number) {
  let first = true;
  let found = 0;
  for (const text of lines) {
    let start = 0;
    while (start < text.length) {
      const mark = !(first && start === 0) && text.charCodeAt(start) === 0xfeff;
      const lineStart = mark ? start + 1 : start;
      const colon = lineStart + width;
      start = colon + 1;
      if (colon === text.length || text[colon] === ":") {
        found++;
      }
    }
    first = false;
  }
  return found;
}
console.log(count(["ab:cd:ef", "﻿ab:cd", "abc"], 2), count([], 1), count(["::::"], 0));
