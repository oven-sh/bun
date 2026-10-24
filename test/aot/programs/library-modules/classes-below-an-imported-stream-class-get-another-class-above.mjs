import { Readable, Writable, Duplex, Transform } from "node:stream";
import { EventEmitter } from "node:events";
new Duplex(); new Transform();
class Below extends Readable {
  extra = 1;
  constructor(options) { super(options); this.late = 2; }
}
class Implicit extends Readable { field = 3; }
const say = value => console.log(value.constructor.name, value instanceof Readable, value instanceof Writable, value instanceof EventEmitter, value.extra, value.late, value.field, typeof value._readableState, typeof value._writableState);
for (let i = 0; i < 3; i++) { say(new Below()); say(new Implicit()); }
Object.setPrototypeOf(Below, Writable);
Object.setPrototypeOf(Implicit, Writable);
say(new Below()); say(new Implicit());
Object.setPrototypeOf(Below, EventEmitter);
Object.setPrototypeOf(Implicit, EventEmitter);
say(new Below()); say(new Implicit());
class Stranger { constructor() { this.strange = true; } }
Object.setPrototypeOf(Below, Stranger);
Object.setPrototypeOf(Implicit, Stranger);
say(new Below()); say(new Implicit()); console.log(new Below().strange, new Implicit().strange);
Object.setPrototypeOf(Below, function Answers() { return { swapped: 1 }; });
console.log(JSON.stringify(new Below()));
Object.setPrototypeOf(Below, null);
try { new Below(); } catch (error) { console.log(error.constructor.name); }
Object.setPrototypeOf(Below, () => 1);
try { new Below(); } catch (error) { console.log(error.constructor.name); }
Object.setPrototypeOf(Below, Readable);
say(new Below());
say(Reflect.construct(Below, [], Implicit));
say(Reflect.construct(Readable, [], Below));
say(Reflect.construct(Below, [], Stranger));
