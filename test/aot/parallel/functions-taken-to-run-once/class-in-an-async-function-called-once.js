(async () => {
  class Task { constructor(n) { this.n = n; } async run() { await null; return this.n + 1; } }
  const first = await new Task(1).run();
  const second = await new Task(first).run();
  console.log(first, second, new Task(0) instanceof Task);
})();
