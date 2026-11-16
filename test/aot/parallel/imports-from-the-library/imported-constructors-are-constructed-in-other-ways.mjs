import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Other { other() { return "other"; } }
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
for (let i = 0; i < 3; i++) {
  const Picked = i & 1 ? EventEmitter : Other;
  const odd = Reflect.construct(EventEmitter, [], Other);
  console.log(new Picked() instanceof EventEmitter, odd instanceof Other, odd instanceof EventEmitter, typeof odd.on, odd.other(), attempt(() => typeof EventEmitter.call({}, {})), attempt(() => Readable() instanceof Readable), attempt(() => new EventEmitter({ captureRejections: i === 1 })[Symbol.for("nodejs.rejection")]), attempt(() => new (EventEmitter.bind(null))() instanceof EventEmitter));
}
