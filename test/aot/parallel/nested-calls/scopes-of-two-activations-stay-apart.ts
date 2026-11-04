function make(tag: string) {
  let calls = 0;
  return { run, peek: () => calls };
  function run(depth: number): string { calls++; return depth > 0 ? inner(depth) : tag + calls; }
  function inner(depth: number): string { return run(depth - 1); }
}
const one = make("a"), two = make("b");
console.log(one.run(2), two.run(0), one.run(1), two.peek(), one.peek());
