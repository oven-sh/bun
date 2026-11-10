const above = Object.getPrototypeOf(process);
above[Symbol.toPrimitive] = () => "here";
above[0] = "zero";
above.next = 7;
above.then = 8;
above.toJSON = () => "as data";
console.log(`${process}`, process[0], process.next, process.then, JSON.stringify({ process }));
