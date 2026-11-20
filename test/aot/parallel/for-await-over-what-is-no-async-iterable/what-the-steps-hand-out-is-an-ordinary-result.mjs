function* pair() { yield { name: "first" }; return { name: "last" }; }
async function* relay() { return yield* pair(); }
const stream = relay();
const one = await stream.next(), two = await stream.next();
console.log(Object.keys(one).join(), one.value.name, one.done, two.value.name, two.done, Object.getPrototypeOf(one) === Object.prototype);
