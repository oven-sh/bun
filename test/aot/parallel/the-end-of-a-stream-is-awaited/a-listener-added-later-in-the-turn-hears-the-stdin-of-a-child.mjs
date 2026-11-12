// The stdin of a child finishes and closes from the event loop: a listener that is added later in the turn that called end() or destroy() hears 'finish' and 'close', and one that is added an immediate later hears only the 'close' that follows the immediates.
import { spawn } from "node:child_process";

// The executable as plain Bun, which reads its stdin to the end.
const reader = () =>
  spawn(process.execPath, ["-e", "process.stdin.resume()"], {
    env: { ...process.env, BUN_BE_BUN: "1" },
    stdio: ["pipe", "ignore", "inherit"],
  });

const calls = {
  'end("abc")': stdin => stdin.end("abc"),
  "destroy()": stdin => stdin.destroy(),
};
const from = {
  "a tick": run => process.nextTick(run),
  "a timer": run => setTimeout(run, 1),
  "an immediate": run => setImmediate(run),
};
const later = {
  "a promise job": add => Promise.resolve().then(add),
  "a tick, then a promise job": add => process.nextTick(() => Promise.resolve().then(add)),
  "an immediate": add => setImmediate(add),
};

const rows = [];
for (const what in calls) {
  for (const where in from) {
    rows.push(
      new Promise(resolve => {
        const child = reader();
        const heard = {};
        from[where](() => {
          calls[what](child.stdin);
          for (const when in later) {
            const events = (heard[when] = []);
            later[when](() => {
              for (const event of ["finish", "close"]) child.stdin.on(event, () => events.push(event));
            });
          }
        });
        child.on("close", () =>
          setImmediate(() =>
            setImmediate(() =>
              resolve(
                Object.keys(later).map(
                  when => `${what} from ${where}, ${when} later: ${heard[when].join(", ") || "nothing"}`,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}
for (const lines of await Promise.all(rows)) console.log(lines.join("\n"));
