Promise.resolve().then(() => console.log("microtask"));
if ([() => {}][0]) {} else await 0;
console.log("dep");
