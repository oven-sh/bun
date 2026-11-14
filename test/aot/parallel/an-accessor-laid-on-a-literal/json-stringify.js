const log = []; const holder = { plain: 1, get lazy() { log.push("got"); return { deep: 7 }; }, set lazy(value) { log.push("set " + value); } };
console.log(JSON.stringify(holder), log.join());
