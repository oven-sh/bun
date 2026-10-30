// What the constructors of EventTarget and AbortController answer, and the objects that a URL, a Request and a Response keep: each used as what it is, with functions that only they call.
const say = (...values: unknown[]) => console.log(...values);
const target = new EventTarget();
target.addEventListener("ping", event => say("listener ran", event.type, event.target === target, event instanceof Event));
say(target.dispatchEvent(new Event("ping")), target instanceof EventTarget, Object.getPrototypeOf(target) === EventTarget.prototype);
class Louder extends EventTarget { shout() { return this.dispatchEvent(new Event("shout")); } }
const louder = new Louder(); louder.addEventListener("shout", { handleEvent(event: Event) { say("handleEvent ran", event.type); } }); say(louder.shout(), louder instanceof Louder);
const controller = new AbortController();
say(controller.signal === controller.signal, controller.signal instanceof AbortSignal, controller.signal.aborted, controller instanceof AbortController);
controller.signal.addEventListener("abort", () => say("abort listener ran", controller.signal.aborted, (controller.signal.reason as { why: string }).why));
controller.signal.throwIfAborted();
const reason = { why: "the reason is kept" };
say(controller.abort(reason), controller.signal.reason === reason);
try { controller.signal.throwIfAborted(); } catch (thrown) { say(thrown === reason); }
const plain = new AbortController(); plain.abort(); say((plain.signal.reason as Error).name, plain.signal.aborted);
const url = new URL("http://a/?x=1&y=2");
say(url.searchParams === url.searchParams, url.searchParams.get("x"), url.searchParams instanceof URLSearchParams);
url.searchParams.set("x", "3"); say(url.href, [...url.searchParams.keys()].join());
(url.searchParams as any).marker = () => "a function put on the kept object"; say((url.searchParams as any).marker());
const handed = new Headers({ a: "1" });
const request = new Request("http://a/", { headers: handed });
say(request.headers === request.headers, request.headers === handed, request.headers.get("a"), request.headers instanceof Headers);
request.headers.set("a", "2"); say(handed.get("a"), request.headers.get("a"));
const response = new Response("body", { headers: handed, status: 201 });
say(response.headers === response.headers, response.headers === handed, response.headers.get("a"), new Response().headers.get("a"), Response.json({}).headers.get("content-type"));
(response.headers as any).marker = () => "and on the headers"; say((response.headers as any).marker());
for (const wrong of [() => (EventTarget as any)(), () => (AbortController as any)(), () => Object.getOwnPropertyDescriptor(AbortController.prototype, "signal")!.get!.call({}), () => AbortController.prototype.abort.call({})])
  try { say(wrong()); } catch (e) { say((e as Error).name); }
