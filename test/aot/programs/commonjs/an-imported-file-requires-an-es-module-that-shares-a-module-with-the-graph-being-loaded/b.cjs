console.log("b runs");
let step = Promise.resolve();
for (let i = 1; i <= 5; i++) step = step.then(() => console.log("b job " + i));
