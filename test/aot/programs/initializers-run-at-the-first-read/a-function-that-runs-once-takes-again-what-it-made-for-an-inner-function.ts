// Functions called on the spot make an object, hand it to an inner function and take it again themselves: they return it behind a try, a branch, a label, a switch or a loop, read it in a handler, or dispose of it.
let budget = 0;
let calls = 0;
function note(trace: unknown[], value: unknown): number {
  calls++;
  trace.push(typeof value === "function" ? "function" : value);
  if (budget && calls === budget) throw new Error("note " + calls);
  return calls;
}
function make(seed: number): { a: number } {
  return { a: seed };
}
function begin(limit: number): unknown[] {
  calls = 0;
  budget = limit;
  return [];
}
function end(name: string, trace: unknown[], result: unknown): void {
  console.log(name, budget, JSON.stringify(trace), JSON.stringify(result));
}

{
  const trace = begin(0);
  end(
    "behind a try",
    trace,
    (() => {
      const held = make(1);
      const read = () => held;
      try {
        note(trace, read());
      } catch (error) {
        trace.push("caught");
      }
      return held;
    })(),
  );
}
{
  const trace = begin(1);
  end(
    "behind a try that catches",
    trace,
    (() => {
      const held = make(2);
      const read = () => held;
      try {
        note(trace, read());
      } catch (error) {}
      return held;
    })(),
  );
}
{
  const trace = begin(0);
  end(
    "behind a finally",
    trace,
    (() => {
      const held = make(3);
      const read = () => held;
      try {
        note(trace, read);
      } finally {
        trace.push("finally");
      }
      return held;
    })(),
  );
}
{
  const trace = begin(0);
  end(
    "behind a branch",
    trace,
    (() => {
      const held = make(4);
      const read = () => held;
      if (note(trace, read) > 0) trace.push("yes");
      else trace.push("no");
      return held;
    })(),
  );
}
{
  const trace = begin(0);
  end(
    "behind a label",
    trace,
    (() => {
      const held = make(5);
      const read = () => held;
      out: {
        if (note(trace, read) > 1) break out;
        trace.push("in");
      }
      return held;
    })(),
  );
}
{
  const trace = begin(0);
  end(
    "behind a switch",
    trace,
    (() => {
      const held = make(6);
      const read = () => held;
      switch (note(trace, read)) {
        case 1:
          trace.push("one");
          break;
        case 2:
          trace.push("two");
          break;
      }
      return held;
    })(),
  );
}
{
  const trace = begin(0);
  end(
    "behind a loop",
    trace,
    (() => {
      const held = make(7);
      const read = () => held;
      for (let i = 0; i < 2; i++) note(trace, read);
      return held;
    })(),
  );
}
{
  const trace = begin(1);
  end(
    "in a handler, as what a variable held first",
    trace,
    (() => {
      const held = make(8);
      const read = () => held;
      let last: unknown = held;
      try {
        note(trace, read);
        last = 2;
        note(trace, read);
      } catch (error) {
        trace.push("caught", last === held, last);
      }
      return 0;
    })(),
  );
}
{
  const trace = begin(2);
  end(
    "in a handler, as what a variable held last",
    trace,
    (() => {
      const held = make(9);
      const read = () => held;
      let last: unknown = 2;
      try {
        note(trace, read);
        last = held;
        note(trace, read);
      } catch (error) {
        trace.push("caught", last === held, last);
      }
      return 0;
    })(),
  );
}
{
  const trace = begin(1);
  let result: unknown;
  try {
    result = (() => {
      const held = make(10);
      const read = () => held;
      try {
        return note(trace, read);
      } catch (error) {
        throw new Error("wrapped " + JSON.stringify(held));
      }
    })();
  } catch (error) {
    result = (error as Error).message;
  }
  end("in the handler of the return, which throws", trace, result);
}
{
  const trace = begin(0);
  end(
    "in the finally of the return",
    trace,
    (() => {
      const held = make(11);
      const read = () => held;
      try {
        return note(trace, read);
      } finally {
        trace.push(held === read(), held);
      }
    })(),
  );
}
{
  const trace = begin(0);
  end(
    "as a resource",
    trace,
    (() => {
      const held = make(12);
      const read = () => held;
      using resource = {
        held,
        [Symbol.dispose]() {
          trace.push("disposed", this.held);
        },
      };
      note(trace, read);
      return resource.held;
    })(),
  );
}
{
  const trace = begin(0);
  let read: () => unknown = () => undefined;
  end(
    "not at all",
    trace,
    (() => {
      const held = make(13);
      read = () => held;
      try {
        note(trace, read);
      } catch (error) {
        trace.push("caught");
      }
      return 0;
    })(),
  );
  console.log("read later", JSON.stringify(read()), read() === read());
}
