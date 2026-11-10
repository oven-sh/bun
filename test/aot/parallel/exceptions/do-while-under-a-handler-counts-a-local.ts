const log: string[] = [];
function say(s: string): void { log.push(s); }
function f(k: number): string {
  let n = 0;
  try { let i = 0; do { say("a"); n++; } while (i++ < 2); }
  finally { say("finally"); }
  return "end" + n;
}
console.log(f(0), f(1), log.join());
