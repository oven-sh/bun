// A Worker ends by an uncaught throw, an unhandled rejection, process.exit in many places, a throw in a listener or a timer, a stack overflow, by running out of work, by close(): the main thread hears the same events in the same order and lives.
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from "node:worker_threads";

class Failure extends Error {
  code = "E_FAILED";
  constructor(message: string, public detail: { n: number }) {
    super(message);
    this.name = "Failure";
  }
}
function deeper(n: number): number {
  return deeper(n + 1) + 1;
}
const ends: Record<string, () => unknown> = {
  "a throw at the top": () => { throw new Failure("at the top", { n: 1 }); },
  "a TypeError of compiled code": () => (null as any).member,
  "a throw of a number": () => { throw 42; },
  "a throw of undefined": () => { throw undefined; },
  "a throw of an object": () => { throw { plain: true, list: [1] }; },
  "a throw of a function": () => { throw () => 1; },
  "a throw of a symbol": () => { throw Symbol("thrown"); },
  "a throw in a timer": () => void setTimeout(() => { throw new Failure("in a timer", { n: 2 }); }, 1),
  "a throw in a microtask": () => queueMicrotask(() => { throw new RangeError("in a microtask"); }),
  "a throw in a listener": () => { parentPort!.on("message", () => { throw new Failure("in a listener", { n: 3 }); }); parentPort!.postMessage("send"); },
  "a rejection nobody handles": () => void Promise.reject(new Failure("rejected", { n: 4 })),
  "a rejection with a number": () => void Promise.reject(5),
  "an async function throws": async () => { await 0; throw new SyntaxError("behind an await"); },
  "a rejection handled late": () => { const p = Promise.reject(new Error("late")); setTimeout(() => p.catch(() => parentPort!.postMessage("handled late")), 5); },
  "a stack overflow": () => deeper(0),
  "a stack overflow that is caught": () => { try { deeper(0); } catch (error) { parentPort!.postMessage((error as Error).name); } },
  "process.exit()": () => process.exit(),
  "process.exit(0)": () => process.exit(0),
  "process.exit(9)": () => process.exit(9),
  "process.exit in a finally": () => { try { throw new Error("covered"); } finally { process.exit(4); } },
  "process.exit in a timer": () => void setTimeout(() => process.exit(5), 1),
  "process.exit in a promise": () => void Promise.resolve().then(() => process.exit(6)),
  "process.exit in an exit listener": () => { process.on("exit", () => process.exit(8)); },
  "process.exitCode": () => { process.exitCode = 11; },
  "an exit listener posts": () => { process.on("exit", (code: number) => parentPort!.postMessage("exit listener " + code)); },
  "process.exit in a getter under JSON.stringify": () => JSON.stringify({ get a() { return process.exit(12); } }),
  "process.exit in a comparator": () => [3, 1, 2].sort(() => process.exit(13)),
  "process.abort is not for workers": () => { try { process.abort(); } catch (error) { parentPort!.postMessage((error as any).code ?? String(error)); } },
  "process.chdir is not for workers": () => { try { process.chdir("/"); } catch (error) { parentPort!.postMessage((error as any).code ?? String(error)); } },
  "nothing left to do": () => 0,
  "a message and nothing left to do": () => parentPort!.postMessage("bye"),
  "many messages and an exit": () => { for (let i = 0; i < 100; i++) parentPort!.postMessage(i); process.exit(0); },
  "an unref'd timer": () => void setInterval(() => {}, 10).unref(),
  "the port is closed": () => { parentPort!.on("message", () => {}); parentPort!.close(); },
  "the port is unref'd": () => { parentPort!.on("message", () => {}); parentPort!.unref(); },
  "an uncaughtException listener": () => { process.on("uncaughtException", (error: Error) => parentPort!.postMessage("caught there: " + error.message)); setTimeout(() => { throw new Error("for the listener"); }, 1); },
  "an unhandledRejection listener": () => { process.on("unhandledRejection", (reason: unknown) => parentPort!.postMessage("rejected there: " + reason)); Promise.reject("for the listener"); },
  "a throw in the uncaughtException listener": () => { process.on("uncaughtException", () => { throw new Error("second"); }); throw new Error("first"); },
};

if (isMainThread) {
  const only = process.env.ONLY;
  for (const name of Object.keys(ends)) {
    if (only && name !== only) continue;
    const events: string[] = [];
    const worker = new NodeWorker(new URL(import.meta.url), { workerData: name, stderr: true, stdout: true });
    worker.stderr.resume();
    worker.stdout.resume();
    let messages = 0;
    worker.on("online", () => events.push("online"));
    worker.on("message", (message: unknown) => {
      if (message === "send") return worker.postMessage("go");
      if (typeof message === "number") messages++;
      else events.push("message " + message);
    });
    worker.on("messageerror", (error: unknown) => events.push("messageerror " + error));
    worker.on("error", (error: unknown) => {
      const e = error as any;
      events.push("error " + (error instanceof Error ? `${e.constructor.name} ${e.name}: ${e.message} code=${e.code} detail=${JSON.stringify(e.detail)} stack=${typeof e.stack}` : typeof e + " " + (typeof e === "symbol" ? "symbol" : JSON.stringify(e))));
    });
    const code = await new Promise(resolve => worker.on("exit", resolve));
    console.log(name + ":", events.join(" | "), messages ? "| numbers " + messages : "", "| exit", code);
  }
  console.log("the main thread lives");
} else {
  await ends[workerData as string]();
}
