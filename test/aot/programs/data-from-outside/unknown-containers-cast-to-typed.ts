// Objects travel in a container whose element type is `unknown`, and the container is cast to a container of a union type. Each object satisfies the union, so reading it back must behave as it does in plain JavaScript.
type Result = { ok: true; status: number; data: string } | { ok: false; status: number; reason: string };
function show(label: string, result: Result) {
  console.log(label + ":", result.ok, result.status, result.ok ? result.data : result.reason);
}

const looseList: unknown[] = [{ ok: true, status: 200, data: "first" }];
looseList.push({ ok: false, status: 500, reason: "second" });
const list = looseList as Result[];
show("array", list[0]);
for (const result of list) show("array, iterated", result);
console.log(list.map(result => result.status).join());

function later(value: unknown): Promise<unknown> {
  return Promise.resolve(value);
}
show("promise", await (later({ ok: true, status: 201, data: "awaited" }) as Promise<Result>));
await (later({ ok: false, status: 501, reason: "then" }) as Promise<Result>).then(result => show("promise, then", result));

const looseMap = new Map<string, unknown>([["a", { ok: true, status: 202, data: "mapped" }]]);
const map = looseMap as Map<string, Result>;
show("map", map.get("a")!);
for (const [key, result] of map) show("map, iterated " + key, result);

const looseSet = new Set<unknown>([{ ok: false, status: 502, reason: "in a set" }]);
for (const result of looseSet as Set<Result>) show("set", result);

const loosePair: [unknown, unknown] = [{ ok: true, status: 203, data: "left" }, { ok: false, status: 503, reason: "right" }];
const [left, right] = loosePair as [Result, Result];
show("tuple", left);
show("tuple", right);

const looseRows: unknown[][] = [[{ ok: true, status: 204, data: "nested" }]];
const rows = looseRows as Result[][];
show("array of arrays", rows[0][0]);
