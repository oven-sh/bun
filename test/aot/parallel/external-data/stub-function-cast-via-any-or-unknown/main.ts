// A typed function is replaced by a stand-in that is cast to `any`, or through `unknown`, on its way to the typed place. The canned objects satisfy the declared result type, so the program must behave as it does in plain JavaScript.
import * as mod from "./api";

type Item = { id: number };
function show(label: string, result: mod.Result<Item>) {
  console.log(label + ":", result.ok, result.ok ? result.status + " " + result.data.id + " " + result.reply.url : result.reason, Object.keys(result).join());
}
function canned(id: number): unknown {
  return { ok: true, status: 200 + id, data: { id }, reply: { headers: {}, url: "u" + id, code: id } };
}

function castToAny(result: unknown) {
  mod.api.post = (async () => result) as any;
}
castToAny(canned(1));
show("cast to any", await mod.sendUnrouted<Item>("/a"));
show("cast to any, routed", await mod.send<Item>("/a"));

function castThroughUnknown(result: unknown) {
  mod.api.post = (async () => result) as unknown as typeof mod.api.post;
}
castThroughUnknown(canned(2));
show("cast through unknown", await mod.send<Item>("/b"));
castThroughUnknown({ ok: false, reason: "refused", detail: "by the stand-in" });
show("the other member of the union", await mod.send<Item>("/c"));

const loose: any = async () => canned(3);
mod.api.post = loose as typeof mod.api.post;
show("a value typed any", await mod.sendUnrouted<Item>("/d"));

mod.api.lookup = ((id: number) => ({ headers: {}, url: "canned " + id, code: 7 })) as any;
console.log(mod.describeLookup(9));
