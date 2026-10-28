// try, catch and finally with returns, breaks and throws on every way out.
function run(mode: number): string {
  const log: string[] = [];
  try {
    log.push("try");
    if (mode === 1) throw new RangeError("one");
    if (mode === 2) return log.join() + " returned";
  } catch (error) {
    log.push(error instanceof RangeError ? error.message : "other");
    if (mode === 1) log.push("caught");
  } finally {
    log.push("finally");
  }
  return log.join();
}
function nested(): number {
  for (let i = 0; i < 3; i++) {
    try {
      if (i === 1) continue;
      if (i === 2) break;
    } finally {
      console.log("leaving", i);
    }
  }
  try {
    return 1;
  } finally {
    console.log("after return");
  }
}
console.log(run(0), run(1), run(2), nested());
try {
  (null as any).x;
} catch ({ name }: any) {
  console.log(name);
}
