const found = Object.values(Object.getOwnPropertyDescriptors(Promise)).map(d => d.value).filter(v => typeof v === "function" && v.name === "allSettled")[0];
console.log(JSON.stringify(await found.call(Promise, [1, Promise.reject(2)])));
