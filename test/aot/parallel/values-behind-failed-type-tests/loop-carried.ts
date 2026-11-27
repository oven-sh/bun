let last: unknown;
function walk(start: any) {
  let count = 0;
  let current = start;
  while (current !== undefined) {
    last = current;
    count++;
    current = current === null ? undefined : current.next;
  }
  return count;
}
console.log(walk({ next: { next: null } }), last === null);
console.log(walk(undefined), walk(null), last === null, walk({ next: undefined }), typeof last);
console.log(walk(5), last, walk("s"), last);
