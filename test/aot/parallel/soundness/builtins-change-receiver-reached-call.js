// One of two or more built-in methods is taken out of a list and reached through call, apply, Reflect.apply or bind. The compiler knows which methods it may be and what each does to its receiver, so a validating build has nothing to find, and what is read of the receiver behind the call is what plain Bun reads.
// Flags: --aot-validate
const which = Math.random() < 2 ? 0 : 1;
function show(what, f) { let last; for (let round = 0; round < 50; round++) last = f(); console.log(what, JSON.stringify(last)); }
show("array, call", () => { const list = [1, 2, 3]; const answer = [list.push, list.pop][which].call(list, 4); return [answer, list.length, list[3]]; });
show("array, apply", () => { const list = [1, 2, 3]; const answer = [list.push, list.pop][which].apply(list, [4, 5]); return [answer, list.length, list[4]]; });
show("array, Reflect.apply", () => { const list = [1, 2, 3]; const answer = Reflect.apply([list.push, list.pop][which], list, [4]); return [answer, list.length, list[3]]; });
show("array, bind", () => { const list = [1, 2, 3]; const answer = [list.push, list.pop][which].bind(list, 4)(); return [answer, list.length, list[3]]; });
show("array, call of call", () => { const list = [1, 2, 3]; const answer = Function.prototype.call.call([list.push, list.pop][which], list, 4); return [answer, list.length, list[3]]; });
show("array, the other one", () => { const list = [1, 2, 3]; const answer = [list.push, list.pop][1 - which].call(list, 4); return [answer, list.length, list[2]]; });
show("array, five methods", () => { const list = [3, 1, 2]; [list.sort, list.reverse, list.shift, list.fill, list.unshift][which].call(list); return list; });
show("array, a text arrives among numbers", () => { const list = [1, 2, 3]; [list.push, list.unshift][which].call(list, "text"); return [typeof list[0], typeof list[3]]; });
show("map, call", () => { const map = new Map([[1, 2]]); const answer = [map.delete, map.has][which].call(map, 1); return [answer, map.size, map.get(1)]; });
show("map, apply", () => { const map = new Map([[1, 2]]); [map.set, map.get][which].apply(map, [3, 4]); return [map.size, map.get(3)]; });
show("map, clear", () => { const map = new Map([[1, 2]]); [map.clear, map.keys][which].call(map); return map.size; });
show("set, call", () => { const set = new Set([1]); const answer = [set.add, set.has][which].call(set, 2); return [answer === set, set.size, set.has(2)]; });
show("set, apply", () => { const set = new Set([1]); const answer = [set.delete, set.has][which].apply(set, [1]); return [answer, set.size]; });
show("in a loop over the receiver", () => { const list = [1, 2, 3]; let sum = 0; for (let i = 0; i < list.length && i < 6; i++) { sum += list[i]; if (i < 2) [list.push, list.pop][which].call(list, 10); } return [sum, list.length]; });
