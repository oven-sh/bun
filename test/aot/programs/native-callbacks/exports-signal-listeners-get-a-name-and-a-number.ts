// Exports of start-up modules: the process calls a signal listener with (name, number), while the program's own call passes (number, string).
let total = 0;

function onSignal(signal: number, code: string): void {
  total += typeof signal === "number" ? 1 : typeof signal === "string" ? 100 : 10000;
  total += typeof code === "string" ? 100000 : typeof code === "number" ? 1000000 : 10000000;
}

onSignal(1, "one");
process.on("SIGUSR2", onSignal as any);
process.kill(process.pid, "SIGUSR2");
let rounds = 0;
const timer = setInterval(() => {
  if (total === 100001 && ++rounds < 150) return;
  clearInterval(timer);
  console.log(total);
}, 10);
