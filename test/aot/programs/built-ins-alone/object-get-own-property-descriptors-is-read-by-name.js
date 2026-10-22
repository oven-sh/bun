const all = Object.getOwnPropertyDescriptors({ first: 1.5, get second() { return "two"; } });
console.log(all.first.value + 1, all.first.writable, typeof all.second.get, all.second.get().length, all.second.value === undefined);
