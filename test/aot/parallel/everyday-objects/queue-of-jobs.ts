// An asynchronous queue of declared jobs with limits and errors
interface Job { name: string; turns: number; fails?: boolean }
async function work(jobs: Job[], limit: number): Promise<string> {
  const log: string[] = [];
  let running = 0, most = 0;
  const next = jobs[Symbol.iterator]();
  const worker = async (): Promise<void> => {
    for (const job of { [Symbol.iterator]: () => next }) {
      most = Math.max(most, ++running);
      try {
        for (let i = 0; i < job.turns; i++) await null;
        if (job.fails) throw new Error(job.name);
        log.push(job.name);
      } catch (error) {
        log.push("!" + (error as Error).message);
      } finally {
        running--;
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return log.join() + " " + most + running;
}
const jobs = (turns: number): Job[] => ["a", "b", "c"].map((name, i) => ({ name, turns: turns - i, fails: i === 1 }));
work(jobs(5), 1).then(text => (console.log(text), work(jobs(9), 2))).then(text => (console.log(text), work([], 3))).then(text => console.log(text));
