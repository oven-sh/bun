console.log("a runs");
let step = Promise.resolve();
for (let i = 1; i <= 6; i++) step = step.then(() => console.log("a job", i));
