// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
function walk(name: string, during: (value: any, seen: unknown[]) => void) { const seen: unknown[] = []; for (const value of box[name]) { seen.push(value); during(value, seen); if (seen.length > 40) break; } return seen; }
box.map = new Map([[1, "a"], [2, "b"], [3, "c"]]);
say(walk("map", ([key]) => { if (key === 1) { box.map.delete(2); box.map.set(4, "d"); } }));
box.map = new Map([[1, "a"], [2, "b"], [3, "c"]]); box.values = box.map.values();
say(walk("values", value => { if (value === "a") { box.map.clear(); box.map.set(9, "z"); } }));
box.map = new Map([[1, "a"], [2, "b"]]); box.keys = box.map.keys();
say(walk("keys", key => { if (key === 1) { box.map.delete(1); box.map.set(1, "again"); } }));
box.map = new Map(); for (let i = 0; i < 12; i++) box.map.set(i, i); box.entries = box.map.entries();
say(walk("entries", ([key]) => { if (key % 2 === 0) box.map.delete(key + 1); if (key === 4) for (let i = 100; i < 300; i++) box.map.set(i, i); }).length, box.map.size);
box.set = new Set([1, 2, 3]);
say(walk("set", value => { if (value < 3) box.set.add(value + 10); if (value === 2) box.set.delete(3); }));
box.set = new Set([1, 2, 3]); box.members = box.set.values();
say(walk("members", value => { if (value === 1) box.set.clear(); if (value === 1) box.set.add(7); }));
box.list = [1, 2, 3]; box.elements = box.list.values();
say(walk("elements", value => { if (value === 1) box.list.push(4, 5); if (value === 4) box.list.length = 2; }));
box.list = [1, 2, 3]; box.pairs = box.list.entries();
say(walk("pairs", ([index]) => { if (index === 0) box.list.unshift(0); }));
box.list = [1, , 3]; box.indexes = box.list.keys(); say(walk("indexes", () => {}));
box.bytes = new Uint8Array([5, 6, 7]).values(); say(walk("bytes", () => {}));
const buffer = new ArrayBuffer(8, { maxByteLength: 16 }); box.view = new Uint8Array(buffer); box.grown = box.view.values();
say(walk("grown", (_, seen) => { if (seen.length === 2) buffer.resize(4); }).length);
box.like = Array.prototype.values.call({ length: 2, 0: "x", 1: "y" }); say(walk("like", () => {}));
