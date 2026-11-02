// An Event that was given a property is spread, and its own keys are listed.
const k = new Event("e");
k.count = 1;
console.log(JSON.stringify({ ...k }));
console.log(Reflect.ownKeys(k).join());
