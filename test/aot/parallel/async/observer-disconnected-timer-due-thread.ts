// An observer of performance marks is disconnected behind a timer that came due while the thread was busy. The mark is made behind an immediate, then behind another timer; each turn prints what the observer had heard by then.
import { performance, PerformanceObserver } from "node:perf_hooks";

function stayBusy(milliseconds: number) {
  for (const began = performance.now(); performance.now() - began < milliseconds; );
}

async function listen(name: string, begin: (resume: () => void) => void) {
  await new Promise<void>(begin);
  const heard: string[] = [];
  const observer = new PerformanceObserver(list => heard.push(...list.getEntries().map(entry => entry.name)));
  observer.observe({ entryTypes: ["mark"] });
  performance.mark(name);
  await new Promise<void>(resume => {
    setTimeout(resume, 2);
    stayBusy(8);
  });
  observer.disconnect();
  console.log(name + ": " + heard.join());
}

for (let turn = 1; turn <= 3; turn++) {
  await listen("behind an immediate " + turn, resume => setImmediate(resume));
  await listen("behind a timer " + turn, resume => setTimeout(resume, 1));
}
