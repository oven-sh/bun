function probe() { const one = process.argv; const before = one.length; process.argv.push("more"); return [one === process.argv, one.length - before].join(); }
console.log(probe());
