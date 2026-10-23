import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { built } from "./run-programs";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const made = {
      url: new URL("https://u:p@example.com:8080/a/b?x=1#h"),
      request: new Request("https://example.com/", { method: "POST", body: "x" }),
      response: new Response("x", { status: 201 }),
      blob: new Blob(["x"], { type: "text/plain" }),
      file: new File(["x"], "n.txt"),
      controller: new AbortController(),
      signal: new AbortController().signal,
      decoder: new TextDecoder(),
      encoder: new TextEncoder(),
      event: new Event("e"),
      custom: new CustomEvent("e", { detail: 1 }),
      message: new MessageEvent("m", { data: 1 }),
      error: new ErrorEvent("e", { message: "m" }),
      close: new CloseEvent("c", { code: 1000 }),
      channel: new MessageChannel(),
      params: new URLSearchParams("a=1"),
      exception: new DOMException("m", "AbortError"),
      performance: performance,
    };
    let seen = 0;
    const note = value => { if (value !== undefined) seen++; };
    function read_url(o) { note(o.href); note(o.origin); note(o.protocol); note(o.username); note(o.password); note(o.host); note(o.hostname); note(o.port); note(o.pathname); note(o.search); note(o.searchParams); note(o.hash); }
    function read_request(o) { note(o.method); note(o.url); note(o.headers); note(o.redirect); note(o.signal); note(o.body); note(o.bodyUsed); note(o.cache); note(o.credentials); note(o.destination); note(o.integrity); note(o.keepalive); note(o.mode); note(o.referrer); note(o.referrerPolicy); }
    function read_response(o) { note(o.type); note(o.url); note(o.redirected); note(o.status); note(o.ok); note(o.statusText); note(o.headers); note(o.body); note(o.bodyUsed); }
    function read_blob(o) { note(o.size); note(o.type); }
    function read_file(o) { note(o.size); note(o.type); note(o.name); note(o.lastModified); }
    function read_controller(o) { note(o.signal); }
    function read_signal(o) { note(o.aborted); note(o.reason); note(o.onabort); }
    function read_decoder(o) { note(o.encoding); note(o.fatal); note(o.ignoreBOM); }
    function read_encoder(o) { note(o.encoding); }
    function read_event(o) { note(o.type); note(o.target); note(o.currentTarget); note(o.eventPhase); note(o.bubbles); note(o.cancelable); note(o.defaultPrevented); note(o.composed); note(o.isTrusted); note(o.timeStamp); note(o.srcElement); note(o.returnValue); note(o.cancelBubble); }
    function read_custom(o) { note(o.detail); note(o.type); note(o.target); note(o.currentTarget); note(o.eventPhase); note(o.bubbles); note(o.cancelable); note(o.defaultPrevented); note(o.composed); note(o.isTrusted); note(o.timeStamp); note(o.srcElement); note(o.returnValue); note(o.cancelBubble); }
    function read_message(o) { note(o.data); note(o.origin); note(o.lastEventId); note(o.source); note(o.ports); note(o.type); note(o.target); note(o.currentTarget); note(o.eventPhase); note(o.bubbles); note(o.cancelable); note(o.defaultPrevented); note(o.composed); note(o.isTrusted); note(o.timeStamp); note(o.srcElement); note(o.returnValue); note(o.cancelBubble); }
    function read_error(o) { note(o.message); note(o.filename); note(o.lineno); note(o.colno); note(o.error); note(o.type); note(o.target); note(o.currentTarget); note(o.eventPhase); note(o.bubbles); note(o.cancelable); note(o.defaultPrevented); note(o.composed); note(o.isTrusted); note(o.timeStamp); note(o.srcElement); note(o.returnValue); note(o.cancelBubble); }
    function read_close(o) { note(o.wasClean); note(o.code); note(o.reason); note(o.type); note(o.target); note(o.currentTarget); note(o.eventPhase); note(o.bubbles); note(o.cancelable); note(o.defaultPrevented); note(o.composed); note(o.isTrusted); note(o.timeStamp); note(o.srcElement); note(o.returnValue); note(o.cancelBubble); }
    function read_channel(o) { note(o.port1); note(o.port2); }
    function read_params(o) { note(o.size); }
    function read_exception(o) { note(o.name); note(o.message); note(o.code); }
    function read_performance(o) { note(o.timeOrigin); }
    const rounds = Number(process.env.ROUNDS ?? 100);
    for (let round = 0; round < rounds; round++) { read_url(made.url); read_request(made.request); read_response(made.response); read_blob(made.blob); read_file(made.file); read_controller(made.controller); read_signal(made.signal); read_decoder(made.decoder); read_encoder(made.encoder); read_event(made.event); read_custom(made.custom); read_message(made.message); read_error(made.error); read_close(made.close); read_channel(made.channel); read_params(made.params); read_exception(made.exception); read_performance(made.performance); }
    console.log("136 getters of 18 kinds of native objects, read", rounds, "times:", seen / rounds);
    Bun.gc(true);
  `,
};

const subclasses = {
  "main.mjs": `
    const made = [];
    for (let i = 0; i < 32; i++) made.push(new (class extends Event {})("e"));
    let seen = 0;
    const note = value => { if (value !== undefined) seen++; };
    function read(o) { note(o.type); note(o.target); note(o.currentTarget); note(o.eventPhase); note(o.bubbles); note(o.cancelable); note(o.defaultPrevented); note(o.composed); note(o.isTrusted); note(o.timeStamp); note(o.srcElement); note(o.returnValue); note(o.cancelBubble); }
    const rounds = Number(process.env.ROUNDS ?? 100);
    for (let round = 0; round < rounds; round++) for (const o of made) read(o);
    console.log("13 getters of 32 subclasses of Event, read", rounds, "times:", seen / rounds);
    Bun.gc(true);
  `,
};

async function slowPathCalls(files: Record<string, string>, expectedOutput: (rounds: number) => string) {
  using dir = tempDir("aot-native-getters-alternating", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  built(await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir), bunEnv));
  const calls: number[] = [];
  for (const rounds of [100, 1100]) {
    const path = join(String(dir), "counts" + rounds);
    const env = {
      ...bunEnv,
      ROUNDS: String(rounds),
      BUN_JSC_crashIfInterpreterIsUsed: "1",
      BUN_JSC_aotCountsPath: path,
    };
    expect(await run([executable], String(dir), env)).toEqual({
      stdout: expectedOutput(rounds),
      stderr: "",
      exitCode: 0,
    });
    let count = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [number, name] = line.split("\toperation:");
      if (name === "operationAOTGetByIdAndCache") count = Number(number);
    }
    calls.push(count);
  }
  return calls;
}

test("136 native getters read alternately stay cached", async () => {
  const calls = await slowPathCalls(
    files,
    rounds => `136 getters of 18 kinds of native objects, read ${rounds} times: 134\n`,
  );
  expect(calls[0]).toBeGreaterThan(0);
  expect(calls[1] - calls[0]).toBeLessThan(3000);
}, 240_000);

test("416 native getters read alternately stay cached", async () => {
  const calls = await slowPathCalls(
    subclasses,
    rounds => `13 getters of 32 subclasses of Event, read ${rounds} times: 416\n`,
  );
  expect(calls[0]).toBeGreaterThan(0);
  expect(calls[1] - calls[0]).toBeLessThan(9000);
}, 240_000);
