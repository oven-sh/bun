// The target, the receiver and the arguments of bound functions arrive late, also for a construction.
function run(f) { "x".replace("x", f); }
function main() {
  function first(a) { return typeof this + ":" + typeof a; }
  function second(a) { return "second " + typeof this.tag + ":" + typeof a; }
  let target = first, self = 1, argument = 2;
  const out = [];
  function change() { target = second; self = { tag: "t" }; argument = { boxed: 1 }; return ""; }
  for (let i = 0; i < 2; i++) { const bound = target.bind(self, argument); out.push(bound()); run(change); }
  console.log(out.join());
  const holder = { bound: first.bind("s", 1) };
  function rebind() { holder.bound = second.bind({ tag: 5 }, "text"); return ""; }
  for (let i = 0; i < 2; i++) { out.push(holder.bound()); run(rebind); }
  console.log(out.join());
  function Made(x) { this.x = x; }
  function Other(x) { this.y = { x }; }
  let constructor = Made;
  function replace() { constructor = Other; return ""; }
  for (let i = 0; i < 2; i++) { const B = constructor.bind(null, i); const made = new B(); console.log(typeof made.x, typeof made.y, made instanceof constructor); run(replace); }
}
main();
