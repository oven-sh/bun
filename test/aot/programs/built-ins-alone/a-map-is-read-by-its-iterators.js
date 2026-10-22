const sizes = new Map([["small", 1.5], ["large", "huge"]]);
console.log([...sizes.keys()].join(), [...sizes.values()].map(each => typeof each).join());
const step = sizes.entries().next();
console.log(step.value[0].length, step.value[1] + 1);
