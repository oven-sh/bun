const [got] = [Promise.prototype].map(each => Object.values(Object.getOwnPropertyDescriptors(each)).map(it => it.value).find(it => typeof it === "function" && it.name === ["th", "en"].join("")));
console.log("SAID", typeof got, await got.call(Promise.resolve(1), (value: number) => value + 1));
