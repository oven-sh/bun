console.log("d runs");
let step = Promise.resolve();
for (let i = 1; i <= 5; i++) step = step.then(() => console.log("d job " + i));
