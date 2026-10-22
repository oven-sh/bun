const copy = structuredClone({ first: 1.5, list: ["two", { three: 3 }], when: new Date(5), map: new Map([["key", 2.5]]) });
console.log(copy.first + 1, copy.list[0].length, copy.list[1].three + 1, copy.when.getTime() + 1, copy.map.get("key") + 1);
