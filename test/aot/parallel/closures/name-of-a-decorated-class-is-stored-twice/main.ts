// The name of a decorated class is stored into twice: the class, then what the decorators answer. Nothing assigns to it, and a function that waits between two reads finds both.
const log: string[] = [];
function run() {
  class Other { kind = "other"; }
  async function watch(when: string) { const before = Marked; await null; const after = Marked; log.push(when + " " + before.name + " " + after.name + " " + (before === after)); }
  function swap(target: any): any { log.push("decorating " + (target === Marked)); pending.push(watch("during")); return Other; }
  const pending: Promise<void>[] = [];
  @swap class Marked { kind = "marked"; }
  pending.push(watch("behind"));
  log.push(new Marked().kind);
  return Promise.all(pending);
}
await run();

const pendingAtTheTop: Promise<void>[] = [];
class Replacement { kind = "replacement"; }
async function watchAtTheTop(when: string) { const before = AtTheTop; await null; const after = AtTheTop; log.push(when + " " + before.name + " " + after.name + " " + (before === after)); }
function swapAtTheTop(target: any): any { pendingAtTheTop.push(watchAtTheTop("during")); return Replacement; }
@swapAtTheTop class AtTheTop { kind = "at the top"; }
pendingAtTheTop.push(watchAtTheTop("behind"));
await Promise.all(pendingAtTheTop);
log.push(new AtTheTop().kind);
console.log(log.join("\n"));
