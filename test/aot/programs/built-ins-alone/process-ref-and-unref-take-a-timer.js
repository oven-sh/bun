const timer = setTimeout(() => console.log("ran"), 1);
console.log(process.unref(timer) === undefined, process.ref(timer) === undefined);
