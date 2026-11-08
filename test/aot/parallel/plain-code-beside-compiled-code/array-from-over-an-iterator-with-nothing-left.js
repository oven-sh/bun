const said = [];
function ask(name, make, add) {
    const { holder, iterator } = make();
    const list = Array.from(iterator);
    add(holder);
    const step = iterator.next();
    said.push(name + ":" + list.length + ":" + (step.done ? "done" : String(step.value)));
}
const intoMap = m => m.set("a", 1), intoSet = s => s.add("a");
ask("keys of an empty map", () => { const holder = new Map(); return { holder, iterator: holder.keys() }; }, intoMap);
ask("values of an empty map", () => { const holder = new Map(); return { holder, iterator: holder.values() }; }, intoMap);
ask("values of an empty set", () => { const holder = new Set(); return { holder, iterator: holder.values() }; }, intoSet);
ask("keys of a map used up by steps", () => { const holder = new Map([["x", 0]]); const iterator = holder.keys(); iterator.next(); return { holder, iterator }; }, intoMap);
ask("values of a set used up by steps", () => { const holder = new Set(["x"]); const iterator = holder.values(); iterator.next(); return { holder, iterator }; }, intoSet);
ask("keys of a map that was cleared", () => { const holder = new Map([["x", 0]]); const iterator = holder.keys(); holder.clear(); return { holder, iterator }; }, intoMap);
ask("values of a set whose one member was deleted", () => { const holder = new Set(["x"]); const iterator = holder.values(); holder.delete("x"); return { holder, iterator }; }, intoSet);
ask("keys of a map with one entry", () => { const holder = new Map([["x", 0]]); return { holder, iterator: holder.keys() }; }, intoMap);
ask("entries of an empty map", () => { const holder = new Map(); return { holder, iterator: holder.entries() }; }, intoMap);
console.log(said.join("\n"));
/* Output:
keys of an empty map:0:a
values of an empty map:0:1
values of an empty set:0:a
keys of a map used up by steps:0:a
values of a set used up by steps:0:a
keys of a map that was cleared:0:a
values of a set whose one member was deleted:0:a
keys of a map with one entry:1:done
entries of an empty map:0:done
*/
