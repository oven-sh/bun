const before = process.cwd();
console.log(process.chdir(before) === undefined, process.cwd() === before);
