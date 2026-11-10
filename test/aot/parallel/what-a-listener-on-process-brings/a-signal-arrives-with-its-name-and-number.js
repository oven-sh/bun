// STATISTIC: ImageFunctionsEmitted <= 20
process.on("SIGUSR2", (name, number) => {
  console.log(name, typeof name, number, typeof number, name.length + number);
  process.exit(0);
});
process.kill(process.pid, "SIGUSR2");
setTimeout(() => console.log("late"), 3000);
