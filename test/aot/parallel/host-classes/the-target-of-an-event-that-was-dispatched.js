// An event that nobody dispatched has no target, and one that was dispatched answers what dispatchEvent() was called on.
const say = (...said) => console.log(...said);
const describe = event =>
  [
    event.target === null,
    event.srcElement === null,
    event.currentTarget === null,
    String(event.target),
    event.target?.constructor.name,
  ].join(" ");

const never = new Event("never");
say("never", describe(never));

const target = new EventTarget();
const atTopLevel = new Event("x");
target.dispatchEvent(atTopLevel);
say("top level", describe(atTopLevel), atTopLevel.target === target);
if (atTopLevel.target === null) say("wrong: no target");
else say("a target");

function inFunction() {
  const event = new Event("x");
  const on = new EventTarget();
  on.dispatchEvent(event);
  return describe(event) + " " + (event.target === on) + " " + (event.target == null ? "none" : "some");
}
say("function", inFunction());

class Holder {
  event = new Event("field");
  on = new EventTarget();
  sent = this.on.dispatchEvent(this.event);
  seen = this.event.target === null ? "none" : "some";
  method() {
    const event = new Event("method");
    this.on.dispatchEvent(event);
    return describe(event) + " " + (event.target === this.on);
  }
}
const holder = new Holder();
say("field", holder.sent, holder.seen, describe(holder.event), holder.event.target === holder.on);
say("method", holder.method());

class OwnTarget extends EventTarget {
  name = "own";
}
class OwnEvent extends Event {
  constructor() {
    super("own");
  }
}
const ownTarget = new OwnTarget();
const ownEvent = new OwnEvent();
say("own before", describe(ownEvent));
ownTarget.dispatchEvent(ownEvent);
say("own", describe(ownEvent), ownEvent.target === ownTarget, ownEvent.target?.name);

for (const made of [
  new CustomEvent("c", { detail: 1 }),
  new MessageEvent("m", { data: 2 }),
  new ErrorEvent("e"),
  new CloseEvent("z"),
]) {
  say(made.constructor.name, "before", describe(made));
  target.dispatchEvent(made);
  say(made.constructor.name, describe(made), made.target === target);
}

const called = new Event("called");
EventTarget.prototype.dispatchEvent.call(target, called);
say("call", describe(called), called.target === target);
const applied = new Event("applied");
Reflect.apply(EventTarget.prototype.dispatchEvent, target, [applied]);
say("apply", describe(applied), applied.target === target);
const bound = new Event("bound");
target.dispatchEvent.bind(target)(bound);
say("bind", describe(bound), bound.target === target);

const onGlobal = new Event("global");
globalThis.dispatchEvent(onGlobal);
say("global", onGlobal.target === null, onGlobal.target === globalThis, onGlobal.srcElement === globalThis);
const bare = new Event("bare");
dispatchEvent(bare);
say("bare", bare.target === null, bare.target === globalThis);
const onPerformance = new Event("performance");
performance.dispatchEvent(onPerformance);
say("performance", onPerformance.target === null, onPerformance.target === performance);

const controller = new AbortController();
const onSignal = new Event("signal");
controller.signal.dispatchEvent(onSignal);
say("signal", describe(onSignal), onSignal.target === controller.signal);

const during = new Event("during");
target.addEventListener("during", seen =>
  say("during", seen === during, during.currentTarget === target, during.currentTarget === null, seen.eventPhase),
);
target.dispatchEvent(during);
say("after", during.currentTarget === null, during.target === target, during.eventPhase);

const flags = new Event("flags", { cancelable: true });
say("flags", flags.cancelBubble, flags.returnValue, typeof flags.timeStamp, flags.timeStamp >= 0);
flags.cancelBubble = "yes";
flags.returnValue = 0;
say("flags", flags.cancelBubble, flags.returnValue, flags.defaultPrevented);
try {
  target.dispatchEvent({ type: "no event" });
} catch (error) {
  say("no event", error.constructor.name);
}
try {
  Object.getOwnPropertyDescriptor(Event.prototype, "target").get.call({});
} catch (error) {
  say("no receiver", error.constructor.name);
}
