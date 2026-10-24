// A test replaces a typed function with a stand-in that returns canned values typed `unknown`, and casts the stand-in to the function's type. The canned objects then reach places typed by the function's declared result. Each of them satisfies that type, so the program must behave as it does in plain JavaScript.
import * as mod from "./api";

type Item = { id: number };
type Call = { args: unknown[] };
function mockPost(result: unknown | ((call: Call) => unknown)) {
  mod.api.post = (async (...args: unknown[]) => {
    const call: Call = { args };
    return typeof result === "function" ? result(call) : result;
  }) as typeof mod.api.post;
}
function show(label: string, result: mod.Result<Item>) {
  console.log(label + ":", result.ok, result.ok ? result.status + " " + result.data.id : result.reason, Object.keys(result).join());
}

show("not replaced", await mod.send<Item>("/real"));

mockPost({ ok: true, status: 200, data: { id: 1 }, reply: { headers: {}, url: "u", code: 1 } });
const complete = await mod.send<Item>("/a");
show("complete", complete);
console.log(complete.route, complete.fromFar, complete.ok && complete.reply.url);
show("complete, unrouted", await mod.sendUnrouted<Item>("/a"));

mockPost({ ok: false, reason: "refused", detail: "by the stand-in" });
show("the other member of the union", await mod.send<Item>("/b"));

mockPost({ ok: true, data: { id: 2 }, status: 201, reply: { headers: { a: "b" }, url: "v", code: 2 }, extra: "kept" });
show("one member more", await mod.send<Item>("/c"));

mockPost((call: Call) => ({ ok: true, status: 202, data: { id: call.args.length }, reply: { headers: {}, url: String(call.args[0]), code: 3 } }));
const computed = await mod.sendUnrouted<Item>("/d");
show("computed by a function", computed);
console.log(computed.ok && computed.reply.url);

mod.api.lookup = ((id: unknown) => ({ headers: {}, url: "canned " + id, code: 7 }) as unknown) as typeof mod.api.lookup;
console.log(mod.describeLookup(9));
