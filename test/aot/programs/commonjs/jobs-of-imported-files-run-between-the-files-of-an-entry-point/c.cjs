console.log("c runs");
let step = Promise.resolve();
for (let i = 1; i <= 6; i++) step = step.then(() => console.log("c job", i));
