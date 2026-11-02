// An async function may call, keep, store or capture a function it is handed, before and after it awaits.
type Next = () => Promise<unknown>;
type Step = (log: string[], next: Next) => unknown;

function compose(steps: Step[]) {
  return function (log: string[], last?: Next) {
    let index = -1;
    return dispatch(0);
    function dispatch(i: number): Promise<unknown> {
      if (i <= index) return Promise.reject(new Error("next() called twice"));
      index = i;
      let step: Step | Next | undefined = steps[i];
      if (i === steps.length) step = last;
      if (!step) return Promise.resolve();
      try {
        return Promise.resolve((step as Step)(log, dispatch.bind(null, i + 1)));
      } catch (error) {
        return Promise.reject(error);
      }
    }
  };
}

let kept: Next | undefined;
let collects = false;
function churn() {
  const junk: { i: number; text: string }[] = [];
  for (let i = 0; i < 300; i++) junk.push({ i, text: "x" + i });
  if (collects) Bun.gc(true);
  return junk.length;
}

const steps: Step[] = [
  async (log, next) => {
    log.push("a1");
    await next();
    churn();
    log.push("a2");
  },
  async (log, next) => {
    log.push("b1");
    await null;
    churn();
    await next();
    log.push("b2");
  },
  async (log, next) => {
    kept = next;
    log.push("c1 " + next.name + " " + next.length);
    await next();
    log.push("c2");
  },
  async (log, next) => {
    log.push("d1");
    const result = next();
    churn();
    await result;
    log.push("d2");
  },
  async (log, next) => {
    try {
      await next();
      churn();
      await next();
    } catch (error) {
      log.push("e " + (error as Error).message);
    }
  },
  (log, next) => {
    log.push("f1");
    return next().then(() => log.push("f2"));
  },
  async (log, next) => {
    const call = () => next();
    log.push("g1");
    await null;
    churn();
    await call();
    log.push("g2");
  },
  async (log, next) => {
    for (let i = 0; i < 2; i++) {
      try {
        await next();
        churn();
        log.push("h" + i);
      } catch (error) {
        log.push("h " + (error as Error).message);
      }
    }
  },
  async (log, next) => {
    try {
      await Promise.reject(new Error("j1"));
    } catch (error) {
      churn();
      log.push((error as Error).message);
      await next();
    }
  },
  async (log, next) => {
    log.push(typeof next + " " + (next instanceof Function));
    if (log.length > 1000) await next();
    else await Promise.all([next(), null]);
    log.push("i2");
  },
];

const run = compose(steps);
let all = 0;
let text = "";
for (let round = 0; round < 400; round++) {
  collects = round % 50 === 49;
  const log: string[] = [];
  await run(log, async () => {
    log.push("last");
  });
  text = log.join(",");
  all = (all * 31 + text.length + round) | 0;
}
console.log(text);
console.log(all);
collects = true;
churn();
console.log(
  await kept!().then(
    () => "resolved",
    error => "rejected: " + error.message,
  ),
);
