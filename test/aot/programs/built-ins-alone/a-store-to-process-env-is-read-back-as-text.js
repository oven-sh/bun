process.env.MADE_HERE = 15;
console.log(typeof process.env.MADE_HERE, process.env.MADE_HERE.length);
delete process.env.MADE_HERE;
console.log(process.env.MADE_HERE === undefined);
