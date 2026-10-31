await { then(done) { done(); } };
for (const step of [1, 2, 3]) console.log("awaits-thenable", await step);
