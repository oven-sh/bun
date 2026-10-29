// The scope of `counts` lies in the frame, and is copied to the heap only where `attempt` is no longer the function it was: a direct eval could have replaced it. The stores behind that go to the scope or to its copy, and both are objects that `counts` has made.
// Flags: --aot-check=verify-each-pass
function attempt(f: () => unknown): string {
  try {
    return String(f());
  } catch (e) {
    return (e as Error).constructor.name;
  }
}
function evaluates(text: string): unknown {
  return eval(text);
}
function counts(mode: number): string {
  const out: string[] = [];
  const get = () => count + ":" + flag + ":" + ratio;
  const set = () => {
    count = 7;
  };
  if (mode === 0) out.push(attempt(get), attempt(set));
  let count = 1,
    flag = true,
    ratio = 1.5;
  out.push(get());
  set();
  out.push(get());
  return out.join();
}
console.log(counts(0), counts(1), evaluates("1 + 1"));
