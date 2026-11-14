// A stack trace lists a native function of the library, which makes the error, above the function of the library that calls it.
import asyncHooks from "node:async_hooks";
import events from "node:events";
import http from "node:http";
import https from "node:https";
import perfHooks from "node:perf_hooks";
import { Readable } from "node:stream";
import util from "node:util";
import zlib from "node:zlib";

function show(label, error) {
  const frames = String(error.stack)
    .split("\n")
    .filter(frame => /\((?:node|internal|bun):|\(unknown\)|\(native\)/.test(frame));
  console.log(label, "|", error.code, "|", frames.map(frame => frame.trim()).join(" | "));
}

function attempt(label, run) {
  try {
    run();
    console.log(label, "nothing");
  } catch (error) {
    show(label, error);
  }
}

attempt("five arguments", () => zlib.gzipSync("a", { level: 99 }));
attempt("five arguments, another caller", () => zlib.inflateSync("a", { windowBits: 99 }));
attempt("four arguments", () => events.setMaxListeners("many"));
attempt("four arguments, an integer", () => http.setMaxIdleHTTPParsers(1n));
attempt("three arguments", () => util.convertProcessSignalToExitCode(1n));
attempt("two arguments", () => asyncHooks.createHook(1n));
attempt("two arguments, a signal", () => events.addAbortListener(1n, () => {}));
attempt("below a constructor", () => new https.Server(1n));
attempt("below a constructor that is called", () => https.Server(1n));
attempt("an object of options", () => perfHooks.createHistogram(1n));
for (let round = 0; round < 3; round++) attempt("again " + round, () => zlib.gzipSync("a", { level: 99 }));
try {
  await Readable.from([1]).toArray(1n);
} catch (error) {
  show("in an async function", error);
}
