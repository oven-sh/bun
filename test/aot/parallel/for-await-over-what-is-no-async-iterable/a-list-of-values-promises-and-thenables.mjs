const seen = [];
for await (const item of [1, Promise.resolve(2), { then(keep) { keep(3); } }]) seen.push(item);
console.log(seen.join());
