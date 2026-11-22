import { expect, jest, mock, setSystemTime, spyOn, test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

test("the clock that a test sets", () => {
  setSystemTime(new Date(86400000));
  roads.tell("set:", () => app.clocks(2));
  setSystemTime(new Date(172800000));
  roads.tell("set anew:", () => app.clocks(2));
  setSystemTime();
  roads.tell("the real one:", () => app.clocks(1).split(",")[0]!.length);
});
test("a spy on Date.now and on Math.random", () => {
  const now = spyOn(Date, "now").mockReturnValue(5), random = spyOn(Math, "random").mockReturnValue(2);
  roads.tell("mocked:", () => [app.clocks(1).split(",")[0], app.draws(2)]);
  expect(now).toHaveBeenCalledTimes(1);
  expect(random).toHaveBeenCalledTimes(2);
  now.mockRestore();
  random.mockRestore();
  roads.tell("restored:", () => [app.clocks(1).split(",")[0]!.length, app.draws(2)]);
});
test("a spy on console.log", () => {
  const spy = spyOn(console, "log").mockImplementation(() => {});
  const sent = app.logs(["one", "two"]);
  const heard = spy.mock.calls.map(call => call[0]).join("+");
  spy.mockRestore();
  console.log("sent", sent, "heard", heard);
  roads.tell("restored:", () => app.logs(["three"]));
});
test("a spy on process.cwd and performance.now", () => {
  roads.tell("as built:", () => [app.folders(1).slice(0, 6), app.ticks(1)]);
  const cwd = spyOn(process, "cwd").mockReturnValue("/x"), now = spyOn(performance, "now").mockReturnValue(-1);
  roads.tell("mocked:", () => [app.folders(2), app.ticks(1)]);
  console.log(cwd.mock.calls.length, now.mock.calls.length);
  cwd.mockRestore();
  now.mockRestore();
  roads.tell("restored:", () => [app.folders(1).slice(0, 6), app.ticks(1)]);
});
test("globals of the host that a test stores over", () => {
  const fetchBefore = roads.everything.fetch, cloneBefore = roads.everything.structuredClone, laterBefore = roads.everything.setTimeout;
  roads.everything.fetch = mock((url: string) => "got " + url);
  roads.everything.structuredClone = (row: object) => ({ copied: Object.keys(row).length });
  roads.everything.setTimeout = () => "no timer";
  roads.tell("replaced:", () => [app.fetched(["a", "b"]), app.copies([{ a: 1 }, {}]), app.later(2)]);
  console.log(roads.everything.fetch.mock.calls.length);
  roads.everything.fetch = fetchBefore;
  roads.everything.structuredClone = cloneBefore;
  roads.everything.setTimeout = laterBefore;
  roads.tell("put back:", () => [app.copies([{ a: 1 }, {}]), app.later(2)]);
});
test("timers that jest fakes", () => {
  jest.useFakeTimers();
  roads.tell("faked:", () => [app.later(1), app.clocks(1).split(",")[0]!.length > 0]);
  jest.useRealTimers();
  roads.tell("real:", () => app.later(1));
});
