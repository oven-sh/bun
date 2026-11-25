const { jest } = Bun.jest();
jest.useFakeTimers();
let ticks = 0;
function tick() {
  ticks++;
  jest.useRealTimers();
}
setInterval(tick, 1);
jest.advanceTimersByTime(5);
process.on("exit", () => console.log(ticks));
