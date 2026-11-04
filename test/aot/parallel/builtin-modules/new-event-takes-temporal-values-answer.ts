// What `new Event(..)` takes and answers, and the three methods of Temporal's classes and of Intl.Locale that a conversion or JSON.stringify may find on a value.
const say = (...values: unknown[]) => console.log(...values);
const plain = new Event("ping");
say(plain.type, plain.bubbles, plain.cancelable, plain.composed, plain.defaultPrevented, plain.eventPhase, plain instanceof Event, Object.getPrototypeOf(plain) === Event.prototype, plain.isTrusted);
const asked = new Event({ toString() { say("toString of the type ran"); return "made"; } } as any, { get bubbles() { say("the getter of bubbles ran"); return 1 as any; }, cancelable: true });
say(asked.type, asked.bubbles, asked.cancelable); asked.preventDefault(); say(asked.defaultPrevented, asked.stopPropagation(), asked.stopImmediatePropagation());
say(new Event(1 as any).type, new Event(null as any).type, new Event("a", null as any).bubbles, new Event("a", Object.create({ composed: true })).composed);
class Loud extends Event { volume = 11; } const loud = new Loud("loud"); say(loud.volume, loud.type, loud instanceof Event, Object.getPrototypeOf(loud) === Loud.prototype);
const target = new EventTarget(); target.addEventListener("loud", event => say("listener ran", event === loud, (event as Loud).volume, event.eventPhase, event.target === target)); say(target.dispatchEvent(loud));
for (const wrong of [() => (Event as any)("a"), () => new (Event as any)(), () => new Event(Symbol("s") as any), () => new Event("a", 1 as any), () => new Event({ toString() { throw new RangeError("from toString"); } } as any), () => Object.getOwnPropertyDescriptor(Event.prototype, "type")!.get!.call({}), () => Event.prototype.preventDefault.call({})])
  try { say(typeof wrong()); } catch (e) { say((e as Error).name, (e as any).code); }
say(new Intl.Locale("en-US").toString(), String(new Intl.Locale("de")), `${new Intl.Locale("fr-CA")}`);
try { Intl.Locale.prototype.toString.call({}); } catch (e) { say((e as Error).name); }
const T = (globalThis as any).Temporal;
if (T) {
  const values = [new T.Duration(1), new T.Instant(0n), new T.PlainDate(2020, 1, 2), new T.PlainDateTime(2020, 1, 2, 3), new T.PlainMonthDay(1, 2), new T.PlainTime(1, 2), new T.PlainYearMonth(2020, 1), new T.ZonedDateTime(0n, "UTC")];
  for (const value of values) {
    say(value.toString(), value.toJSON(), JSON.stringify({ value }), `${value}`);
    try { say(value.valueOf()); } catch (e) { say((e as Error).name); }
    try { say(value > 1); } catch (e) { say((e as Error).name); }
    try { value.toJSON.call({}); } catch (e) { say((e as Error).name); }
  }
  say(new T.PlainTime(1, 2, 3).toString({ get smallestUnit() { say("the getter of smallestUnit ran"); return "minute"; } }));
} else say("this build has no Temporal");
