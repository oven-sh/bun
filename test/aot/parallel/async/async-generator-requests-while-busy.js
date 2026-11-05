// Requests queued on a busy async generator: five next(), one throw() and one return(thenable) issued in one turn, in three orders, on a generator that is unstarted, suspended at a yield, busy, awaiting a return value or completed; requests issued by the body and by a then(); bodies that throw after an await; return(value that rejects), which must not run an unstarted or completed body.
const lines = [];
let log = [];
const note = text => void log.push(text);
const show = value => (value instanceof Error ? `${value.name}(${value.message})` : String(value));

function report(label, request) {
  return request.then(
    step => note(`${label}: ${step.done ? "done" : "step"} ${show(step.value)}`),
    error => note(`${label}: rejected ${show(error)}`),
  );
}

// Logs each turn of the job queue, so the log shows the turn in which a request settled. While it runs, the queue is never empty.
const maxTurns = 200;
function startClock() {
  let turn = 0;
  let isRunning = true;
  const tick = () => {
    if (!isRunning || turn === maxTurns) return;
    note(`turn ${++turn}`);
    queueMicrotask(tick);
  };
  queueMicrotask(tick);
  return () => void (isRunning = false);
}

const pending = () => new Promise(resolve => void Promise.resolve().then(() => {}).then(resolve));
const waits = [
  ["settled awaits", () => null],
  ["pending awaits", pending],
];

function thenable(label) {
  return {
    then(resolve) {
      note(`${label}.then called`);
      resolve(`${label} value`);
    },
  };
}

function handled(promise) {
  promise.catch(() => {});
  return promise;
}

function fail(value) {
  throw value;
}

async function* counter(wait) {
  note("body starts");
  for (let i = 0; i < 8; i++) {
    await wait();
    const sent = yield i;
    note(`body received ${show(sent)}`);
  }
  return "result";
}

async function* counterWithCleanup(wait) {
  note("body starts");
  try {
    for (let i = 0; i < 8; i++) {
      await wait();
      const sent = yield i;
      note(`body received ${show(sent)}`);
    }
  } catch (error) {
    note(`body caught ${show(error)}`);
    await wait();
    const sent = yield "recovered";
    note(`body received ${show(sent)}`);
  } finally {
    note("body cleanup starts");
    await wait();
    note("body cleanup ends");
  }
  return "result";
}

async function* requestsFromBody(wait) {
  const self = yield "ready";
  report("inner next", self.next("sent by body"));
  report("inner return", self.return(thenable("inner")));
  note("body still running");
  await wait();
  const sent = yield "after inner requests";
  note(`body received ${show(sent)}`);
  return "result";
}

async function* throwsAfterAwait(wait, value) {
  note("body starts");
  await wait();
  note("body throws");
  throw value;
}

async function* calleeThrowsAfterAwait(wait, value) {
  yield "first";
  await wait();
  fail(value);
  note("body continued after the throw");
}

async function* catchesRejectedOperand(wait) {
  try {
    yield handled(Promise.reject(new RangeError("rejected operand")));
  } catch (error) {
    note(`body caught ${show(error)}`);
    await wait();
    yield "recovered";
  }
}

async function* entersAnotherBodyThenThrows(wait, reports) {
  const inner = counter(wait);
  await wait();
  reports.push(report("inner next", inner.next("sent by outer body")));
  throw new RangeError("thrown by outer body");
}

const bodies = [
  ["no handlers", counter],
  ["catch and finally", counterWithCleanup],
];
const sources = bodies.flatMap(([bodyName, body]) =>
  waits.map(([waitName, wait]) => [`${bodyName}, ${waitName}`, () => body(wait)]),
);

const leaveUnstarted = () => {};
const states = [
  ["unstarted", leaveUnstarted],
  ["suspended at a yield", generator => generator.next("earlier")],
  ["busy", generator => void report("earlier next", generator.next("earlier"))],
  ["awaiting a return value", generator => void report("earlier return", generator.return(pending()))],
  [
    "completed",
    async generator => {
      while (!(await generator.next("earlier")).done);
    },
  ],
];

const orders = [
  ["next", "next", "next", "next", "next", "throw", "return"],
  ["throw", "next", "next", "next", "next", "next", "return"],
  ["return", "next", "next", "next", "next", "next", "throw"],
];

const send = {
  next: (generator, index) => generator.next(`sent ${index}`),
  throw: generator => generator.throw(new TypeError("thrown by request")),
  return: generator => generator.return(thenable("returned")),
};

function issue(generator, kinds) {
  let last;
  kinds.forEach((kind, index) => {
    last = report(`${kind} ${index}`, send[kind](generator, index));
    queueMicrotask(() => note(`job ${index}`));
  });
  return last;
}

const thrownValues = [
  ["an error", () => new RangeError("thrown by body")],
  ["undefined", () => undefined],
];

const rejectingValues = [
  ["a rejected promise", () => handled(Promise.reject(new RangeError("rejected")))],
  ["a promise rejected later", () => handled(pending().then(() => fail(new RangeError("rejected later"))))],
  [
    "an object whose then getter throws",
    () => ({
      get then() {
        note("then read");
        throw new RangeError("then getter throws");
      },
    }),
  ],
  [
    "a promise whose constructor getter throws",
    () =>
      Object.defineProperty(Promise.resolve("unused"), "constructor", {
        get() {
          note("constructor read");
          throw new RangeError("constructor getter throws");
        },
      }),
  ],
];

async function scene(title, create, enterState, act) {
  for (const withClock of [false, true]) {
    const generator = create();
    await enterState(generator);
    log = [];
    const stopClock = withClock ? startClock() : () => {};
    await act(generator);
    stopClock();
    await null;
    lines.push(`${title}${withClock ? ", with clock" : ""}: ${log.join(" | ")}`);
  }
}

async function main() {
  for (const [stateName, enterState] of states) {
    for (const kinds of orders) {
      for (const [sourceName, create] of sources) {
        const title = `${stateName}, ${kinds[0]} first, ${sourceName}`;
        await scene(title, create, enterState, generator => issue(generator, kinds));
      }
    }
  }

  for (const [waitName, wait] of waits) {
    await scene(
      `requests issued by the body, ${waitName}`,
      () => requestsFromBody(wait),
      generator => generator.next(),
      async generator => {
        await report("outer next", generator.next(generator));
        await report("last next", generator.next("last"));
      },
    );

    await scene(
      `rejected yield operand, ${waitName}`,
      () => catchesRejectedOperand(wait),
      leaveUnstarted,
      generator => issue(generator, ["next", "next", "next"]),
    );

    let reports;
    await scene(
      `body enters another body, then throws, ${waitName}`,
      () => entersAnotherBodyThenThrows(wait, (reports = [])),
      leaveUnstarted,
      async generator => {
        await issue(generator, ["next", "next"]);
        await Promise.all(reports);
      },
    );

    for (const [bodyName, body] of [
      ["body throws after an await", throwsAfterAwait],
      ["callee throws after an await", calleeThrowsAfterAwait],
    ]) {
      for (const [valueName, createValue] of thrownValues) {
        await scene(
          `${bodyName}, ${valueName}, ${waitName}`,
          () => body(wait, createValue()),
          leaveUnstarted,
          async generator => {
            await issue(generator, ["next", "next", "next", "return", "throw", "next"]);
            await report("late next", generator.next());
          },
        );
      }
    }
  }

  await scene(
    "next issued by then() of a return value",
    () => counter(pending),
    leaveUnstarted,
    async generator => {
      let fromThen;
      const value = {
        then(resolve) {
          fromThen = report("next from then", generator.next());
          resolve("resolved");
        },
      };
      await report("return", generator.return(value));
      await fromThen;
    },
  );

  for (const [valueName, createValue] of rejectingValues) {
    for (const [stateName, enterState] of states) {
      await scene(
        `return of ${valueName}, ${stateName}`,
        () => counterWithCleanup(pending),
        enterState,
        async generator => {
          report("return", generator.return(createValue()));
          await report("next", generator.next("after return"));
          note(log.some(text => text.startsWith("body")) ? "body ran" : "body did not run");
        },
      );
    }
  }

  await scene(
    "queued requests survive collections",
    () => counterWithCleanup(() => void Bun.gc(true)),
    leaveUnstarted,
    generator => issue(generator, orders[0]),
  );
}

main().then(() => console.log(lines.join("\n")));
