// process.nextTick is made by a function of Bun's own library when the property is first read.
process.nextTick((first, second) => console.log("tick", first, second), 1, 2);
console.log("before the tick");
