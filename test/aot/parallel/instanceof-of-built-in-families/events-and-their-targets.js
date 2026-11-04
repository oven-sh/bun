const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isEvent(x) { return x instanceof Event; }
function countEvent(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Event) count++; } return count; }
function isCustomEvent(x) { return x instanceof CustomEvent; }
function countCustomEvent(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof CustomEvent) count++; } return count; }
function isMessageEvent(x) { return x instanceof MessageEvent; }
function countMessageEvent(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof MessageEvent) count++; } return count; }
function isErrorEvent(x) { return x instanceof ErrorEvent; }
function countErrorEvent(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ErrorEvent) count++; } return count; }
function isCloseEvent(x) { return x instanceof CloseEvent; }
function countCloseEvent(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof CloseEvent) count++; } return count; }
function isEventTarget(x) { return x instanceof EventTarget; }
function countEventTarget(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof EventTarget) count++; } return count; }
function isAbortController(x) { return x instanceof AbortController; }
function countAbortController(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof AbortController) count++; } return count; }
function isAbortSignal(x) { return x instanceof AbortSignal; }
function countAbortSignal(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof AbortSignal) count++; } return count; }
function isPerformance(x) { return x instanceof Performance; }
function countPerformance(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Performance) count++; } return count; }
const tests = [["Event", isEvent, countEvent], ["CustomEvent", isCustomEvent, countCustomEvent], ["MessageEvent", isMessageEvent, countMessageEvent], ["ErrorEvent", isErrorEvent, countErrorEvent], ["CloseEvent", isCloseEvent, countCloseEvent], ["EventTarget", isEventTarget, countEventTarget], ["AbortController", isAbortController, countAbortController], ["AbortSignal", isAbortSignal, countAbortSignal], ["Performance", isPerformance, countPerformance]];
const values = [];
maybe("created below Event.prototype", () => Object.create(Event.prototype), values);
maybe("Event.prototype", () => Event.prototype, values);
maybe("Event", () => Event, values);
maybe("new Event", () => new Event("a"), values);
maybe("new of a class below Event", () => new (class extends Event {})("a"), values);
maybe("new Event without its prototype", () => Object.setPrototypeOf(new Event("a"), null), values);
maybe("new Event below CustomEvent.prototype", () => Object.setPrototypeOf(new Event("a"), CustomEvent.prototype), values);
maybe("a proxy of new Event", () => new Proxy(new Event("a"), {}), values);
maybe("Event made for CustomEvent as new.target", () => Reflect.construct(Event, ["a"], CustomEvent), values);
maybe("created below CustomEvent.prototype", () => Object.create(CustomEvent.prototype), values);
maybe("CustomEvent.prototype", () => CustomEvent.prototype, values);
maybe("CustomEvent", () => CustomEvent, values);
maybe("new CustomEvent", () => new CustomEvent("a"), values);
maybe("new of a class below CustomEvent", () => new (class extends CustomEvent {})("a"), values);
maybe("new CustomEvent without its prototype", () => Object.setPrototypeOf(new CustomEvent("a"), null), values);
maybe("new CustomEvent below MessageEvent.prototype", () => Object.setPrototypeOf(new CustomEvent("a"), MessageEvent.prototype), values);
maybe("a proxy of new CustomEvent", () => new Proxy(new CustomEvent("a"), {}), values);
maybe("CustomEvent made for MessageEvent as new.target", () => Reflect.construct(CustomEvent, ["a"], MessageEvent), values);
maybe("created below MessageEvent.prototype", () => Object.create(MessageEvent.prototype), values);
maybe("MessageEvent.prototype", () => MessageEvent.prototype, values);
maybe("MessageEvent", () => MessageEvent, values);
maybe("new MessageEvent", () => new MessageEvent("a"), values);
maybe("new of a class below MessageEvent", () => new (class extends MessageEvent {})("a"), values);
maybe("new MessageEvent without its prototype", () => Object.setPrototypeOf(new MessageEvent("a"), null), values);
maybe("new MessageEvent below ErrorEvent.prototype", () => Object.setPrototypeOf(new MessageEvent("a"), ErrorEvent.prototype), values);
maybe("a proxy of new MessageEvent", () => new Proxy(new MessageEvent("a"), {}), values);
maybe("MessageEvent made for ErrorEvent as new.target", () => Reflect.construct(MessageEvent, ["a"], ErrorEvent), values);
maybe("created below ErrorEvent.prototype", () => Object.create(ErrorEvent.prototype), values);
maybe("ErrorEvent.prototype", () => ErrorEvent.prototype, values);
maybe("ErrorEvent", () => ErrorEvent, values);
maybe("new ErrorEvent", () => new ErrorEvent("a"), values);
maybe("new of a class below ErrorEvent", () => new (class extends ErrorEvent {})("a"), values);
maybe("new ErrorEvent without its prototype", () => Object.setPrototypeOf(new ErrorEvent("a"), null), values);
maybe("new ErrorEvent below CloseEvent.prototype", () => Object.setPrototypeOf(new ErrorEvent("a"), CloseEvent.prototype), values);
maybe("a proxy of new ErrorEvent", () => new Proxy(new ErrorEvent("a"), {}), values);
maybe("ErrorEvent made for CloseEvent as new.target", () => Reflect.construct(ErrorEvent, ["a"], CloseEvent), values);
maybe("created below CloseEvent.prototype", () => Object.create(CloseEvent.prototype), values);
maybe("CloseEvent.prototype", () => CloseEvent.prototype, values);
maybe("CloseEvent", () => CloseEvent, values);
maybe("new CloseEvent", () => new CloseEvent("a"), values);
maybe("new of a class below CloseEvent", () => new (class extends CloseEvent {})("a"), values);
maybe("new CloseEvent without its prototype", () => Object.setPrototypeOf(new CloseEvent("a"), null), values);
maybe("new CloseEvent below EventTarget.prototype", () => Object.setPrototypeOf(new CloseEvent("a"), EventTarget.prototype), values);
maybe("a proxy of new CloseEvent", () => new Proxy(new CloseEvent("a"), {}), values);
maybe("CloseEvent made for EventTarget as new.target", () => Reflect.construct(CloseEvent, ["a"], EventTarget), values);
maybe("created below EventTarget.prototype", () => Object.create(EventTarget.prototype), values);
maybe("EventTarget.prototype", () => EventTarget.prototype, values);
maybe("EventTarget", () => EventTarget, values);
maybe("new EventTarget", () => new EventTarget(), values);
maybe("new of a class below EventTarget", () => new (class extends EventTarget {})(), values);
maybe("new EventTarget without its prototype", () => Object.setPrototypeOf(new EventTarget(), null), values);
maybe("new EventTarget below AbortController.prototype", () => Object.setPrototypeOf(new EventTarget(), AbortController.prototype), values);
maybe("a proxy of new EventTarget", () => new Proxy(new EventTarget(), {}), values);
maybe("EventTarget made for AbortController as new.target", () => Reflect.construct(EventTarget, [], AbortController), values);
maybe("created below AbortController.prototype", () => Object.create(AbortController.prototype), values);
maybe("AbortController.prototype", () => AbortController.prototype, values);
maybe("AbortController", () => AbortController, values);
maybe("new AbortController", () => new AbortController(), values);
maybe("new of a class below AbortController", () => new (class extends AbortController {})(), values);
maybe("new AbortController without its prototype", () => Object.setPrototypeOf(new AbortController(), null), values);
maybe("new AbortController below AbortSignal.prototype", () => Object.setPrototypeOf(new AbortController(), AbortSignal.prototype), values);
maybe("a proxy of new AbortController", () => new Proxy(new AbortController(), {}), values);
maybe("AbortController made for AbortSignal as new.target", () => Reflect.construct(AbortController, [], AbortSignal), values);
maybe("created below AbortSignal.prototype", () => Object.create(AbortSignal.prototype), values);
maybe("AbortSignal.prototype", () => AbortSignal.prototype, values);
maybe("AbortSignal", () => AbortSignal, values);
maybe("created below Performance.prototype", () => Object.create(Performance.prototype), values);
maybe("Performance.prototype", () => Performance.prototype, values);
maybe("Performance", () => Performance, values);
maybe("AbortSignal.abort()", () => (AbortSignal.abort()), values);
maybe("new AbortController().signal", () => (new AbortController().signal), values);
maybe("AbortSignal.any([])", () => (AbortSignal.any([])), values);
maybe("performance", () => (performance), values);
maybe("globalThis.process", () => (globalThis.process), values);
maybe(`new (require("events"))()`, () => (new (require("events"))()), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Event: " + (Event[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Event, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Event, value))) + show(attempt(() => Event[Symbol.hasInstance](value)))).join(""));
report("CustomEvent: " + (CustomEvent[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(CustomEvent, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(CustomEvent, value))) + show(attempt(() => CustomEvent[Symbol.hasInstance](value)))).join(""));
report("MessageEvent: " + (MessageEvent[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(MessageEvent, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(MessageEvent, value))) + show(attempt(() => MessageEvent[Symbol.hasInstance](value)))).join(""));
report("ErrorEvent: " + (ErrorEvent[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ErrorEvent, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ErrorEvent, value))) + show(attempt(() => ErrorEvent[Symbol.hasInstance](value)))).join(""));
report("CloseEvent: " + (CloseEvent[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(CloseEvent, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(CloseEvent, value))) + show(attempt(() => CloseEvent[Symbol.hasInstance](value)))).join(""));
report("EventTarget: " + (EventTarget[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(EventTarget, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(EventTarget, value))) + show(attempt(() => EventTarget[Symbol.hasInstance](value)))).join(""));
report("AbortController: " + (AbortController[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(AbortController, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(AbortController, value))) + show(attempt(() => AbortController[Symbol.hasInstance](value)))).join(""));
report("AbortSignal: " + (AbortSignal[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(AbortSignal, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(AbortSignal, value))) + show(attempt(() => AbortSignal[Symbol.hasInstance](value)))).join(""));
report("Performance: " + (Performance[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Performance, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Performance, value))) + show(attempt(() => Performance[Symbol.hasInstance](value)))).join(""));
process.exit(0);
