// Async code has its next job in the queue when its thread meets an end: an error that nobody catches in a microtask, a tick, a timer or a message listener, a rejection that nobody handles, process.exit(), terminate(). A Worker runs nothing behind that end. The main thread reports an error and goes on.
import { workerData } from "node:worker_threads";

const wordsOfAWait = 4;
const [wentOn, thenWasCalled, finallyRan, isTerminated] = [0, 1, 2, 3];

const one = async () => 1;
async function* numbers() {
  yield 1;
  yield 2;
}
async function* awaitsInside(at: number) {
  await 1;
  ran[at + wentOn]++;
  yield 1;
}
function* yieldsOnce(at: number) {
  yield 1;
  ran[at + wentOn]++;
}
const thenable = (at: number) => ({
  then(resolve: (value: number) => void) {
    ran[at + thenWasCalled]++;
    resolve(1);
  },
});

let openGate = () => {};
const gate = new Promise<void>(resolve => (openGate = resolve));

const waits: Record<string, (at: number) => unknown> = {
  "await of a promise": async at => { await Promise.resolve(1); ran[at + wentOn]++; },
  "await of a thenable": async at => { await thenable(at); ran[at + wentOn]++; },
  "await of a value": async at => { await 1; ran[at + wentOn]++; },
  "await of a call": async at => { await one(); ran[at + wentOn]++; },
  "await in a try block": async at => { try { await 1; ran[at + wentOn]++; } finally { ran[at + finallyRan]++; } },
  "for await over a list": async at => { for await (const _ of [1, 2]) ran[at + wentOn]++; },
  "for await over an async generator": async at => { for await (const _ of numbers()) ran[at + wentOn]++; },
  "an await inside an async generator": at => awaitsInside(at).next(),
  "a thenable handed to resolve": at => Promise.resolve(thenable(at)),
  "a top-level await": () => openGate(),
  "a finally handler": at => Promise.resolve(1).finally(() => void ran[at + finallyRan]++),
  "a step of a generator": at => { const steps = yieldsOnce(at); steps.next(); return Promise.resolve(1).then(steps.next.bind(steps)); },
  "pull() of a stream": at => new ReadableStream({ pull(controller) { ran[at + wentOn]++; controller.close(); } }).getReader().read(),
  "a reaction": at => Promise.resolve(1).then(() => ran[at + wentOn]++),
  "a microtask": at => queueMicrotask(() => void ran[at + wentOn]++),
  "a tick": at => process.nextTick(() => void ran[at + wentOn]++),
  "a timer": at => setTimeout(() => void ran[at + wentOn]++, 0),
};
const namesOfWaits = Object.keys(waits);

const stop = () => {
  throw new RangeError("stop");
};
const ends: Record<string, (start: () => void) => void> = {
  "a throw in a microtask": start => { queueMicrotask(stop); start(); },
  "a throw in a tick": start => { process.nextTick(() => { start(); stop(); }); },
  "a throw in a timer": start => { setTimeout(() => { start(); stop(); }, 1); },
  "a throw in a message listener": start => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { port1.close(); start(); stop(); };
    port2.postMessage(0);
  },
  "a rejection nobody handles": start => { Promise.reject(new RangeError("stop")); start(); },
  "process.exit() in a microtask": start => { queueMicrotask(() => process.exit(3)); start(); },
  "process.exit() behind the await": start => { start(); process.exit(3); },
  "terminate()": start => {
    queueMicrotask(() => {
      postMessage("terminate me");
      Atomics.wait(ran, isTerminated, 0, 60_000);
    });
    start();
  },
};

const ran: Int32Array = Bun.isMainThread ? new Int32Array(new SharedArrayBuffer(4 * wordsOfAWait * namesOfWaits.length)) : workerData;

function told(words: Int32Array, name: string) {
  const at = wordsOfAWait * namesOfWaits.indexOf(name);
  const parts = [words[at + thenWasCalled] && "then was called", words[at + wentOn] && "went on " + words[at + wentOn], words[at + finallyRan] && "the finally ran"];
  return name + ": " + (parts.filter(Boolean).join(", ") || "nothing");
}

if (process.env.END) {
  const started = (process.env.WAIT ?? namesOfWaits.join("|")).split("|");
  if (Bun.isMainThread) process.on("exit", () => console.log(started.map(name => told(ran, name)).join("\n")));
  ends[process.env.END](() => {
    for (const name of started) waits[name](wordsOfAWait * namesOfWaits.indexOf(name));
  });
  if (started.includes("a top-level await")) {
    await gate;
    ran[wordsOfAWait * namesOfWaits.indexOf("a top-level await") + wentOn]++;
  }
} else {
  const itself = process.argv[1].includes("$bunfs") || process.argv[1].includes("~BUN") ? [process.execPath] : [process.execPath, process.argv[1]];
  for (const end of Object.keys(ends)) {
    const lines = await Promise.all(namesOfWaits.map(async name => {
      const words = new Int32Array(new SharedArrayBuffer(ran.byteLength));
      const events: string[] = [];
      const worker = new Worker(new URL(import.meta.url), { env: { ...process.env, END: end, WAIT: name }, workerData: words } as any);
      worker.onmessage = () => {
        worker.terminate();
        Atomics.store(words, isTerminated, 1);
        Atomics.notify(words, isTerminated);
      };
      worker.onerror = event => {
        events.push("error " + /\w+: stop/.exec(event.message)?.[0]);
        event.preventDefault();
      };
      events.push("close " + (await new Promise(resolve => worker.addEventListener("close", event => resolve((event as any).code)))));
      return "  " + told(words, name) + " | " + events.join(" | ");
    }));
    console.log(end + ", in a Worker:\n" + lines.join("\n"));

    if (end === "terminate()") continue;
    const child = Bun.spawn(itself, { env: { ...process.env, END: end }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(end + ", on the main thread: " + (/^\w+: stop/m.exec(err)?.[0] ?? "no error") + ", exit " + (await child.exited) + "\n" + out.trimEnd().replace(/^/gm, "  "));
  }
}
