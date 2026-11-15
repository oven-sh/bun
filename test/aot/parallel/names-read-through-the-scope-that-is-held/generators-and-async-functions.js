function make(skip, base) {
  let at = base;
  return {
    *walk() { while (at < base + 3) { yield skip ? at : -at; at++; } },
    async later() { await null; return at + ":" + skip + ":" + base; },
  };
}
const made = make(true, 5);
console.log([...made.walk()].join(), await made.later());
