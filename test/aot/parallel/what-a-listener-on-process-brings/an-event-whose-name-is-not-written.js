// The text is not written at the call: every row that may fit counts.
const name = JSON.parse('"SIGUSR1"');
process.on(name, (signal, number) => { console.log(signal, number > 0); process.exit(0); });
process.kill(process.pid, name);
setTimeout(() => console.log("late"), 3000);
