// A module variable that nothing reads holds the only other reference to an object. The variable may go, but the language keeps the target of a weak reference alive from its creation, and from each deref, to the end of the job, whatever the collector does meanwhile. (Bun.gc() ends that promise on purpose, so the collections here are fullGC()'s.)
import { fullGC } from "bun:jsc";

class Session {
  constructor(public id: number, public log: string[]) {}
}
function open(id: number): WeakRef<Session> {
  const session = new Session(id, ["opened " + id]);
  onlyHolder = session;
  return new WeakRef(session);
}
let onlyHolder: Session;
const reference = open(7);
fullGC();
for (let i = 0; i < 20000; i++) new Session(i, [String(i)]);
fullGC();
const found = reference.deref();
console.log(found !== undefined, found?.id, found?.log.join());

await Promise.resolve();
const again = open(8);
fullGC();
console.log(again.deref()?.id, again.deref()?.log.join());
