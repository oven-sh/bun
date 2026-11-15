function make(a, skip = a * 2, more = () => skip + a) {
  let at = 0;
  return { next() { at += skip; return at; }, peek: () => at + skip, more };
}
for (const a of [1, 2]) { const made = make(a); console.log(made.next(), made.next(), made.peek(), made.more()); }
console.log(make(1, 5).next(), make(1, undefined).peek());
