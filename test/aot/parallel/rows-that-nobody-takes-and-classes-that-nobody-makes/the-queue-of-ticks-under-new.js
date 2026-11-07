const made = new process.nextTick(() => console.log("ticked"));
console.log(typeof made, made === null);
