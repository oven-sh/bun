/** @typedef {{ start: number, end: number }} Span */
/** @param {Span} head @param {Span[]} tail @returns {Span[]} */
function join(head, tail) {
  if (tail.length === 0) tail = [head];
  else if (head.end === tail[0].start) tail[0].start = head.start;
  else tail.unshift(head);
  return tail;
}
function next(text, from) { for (let i = from; i < text.length; i++) if (text[i] === " ") return i + 1; return text.length; }
/** @param {string} word @param {string} target @param {number} i @param {number} j @returns {Span[] | null} */
export function match(word, target, i, j) {
  if (i === word.length) return [];
  else if (j === target.length) return null;
  else if (word[i] !== target[j].toLowerCase()) return null;
  else {
    let result = null, at = j + 1;
    result = match(word, target, i + 1, j + 1);
    while (!result && (at = next(target, at)) < target.length) { result = match(word, target, i + 1, at); at++; }
    return result === null ? null : join({ start: j, end: j + 1 }, result);
  }
}
export function matches(word, target) {
  if (!target || target.length === 0) return null;
  let result = null, at = 0;
  word = word.toLowerCase();
  while (at < target.length && (result = match(word, target, 0, at)) === null) at = next(target, at + 1);
  return result;
}
