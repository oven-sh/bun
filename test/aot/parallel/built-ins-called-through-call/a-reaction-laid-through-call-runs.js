const answer = await Promise.prototype.then.call(Promise.resolve(3), value => value * 2);
const caught = await Promise.prototype.catch.call(Promise.reject(new Error("made up")), error => error.message);
console.log(`${answer} ${caught}`);
