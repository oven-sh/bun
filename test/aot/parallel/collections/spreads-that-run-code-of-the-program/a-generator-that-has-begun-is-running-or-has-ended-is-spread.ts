function* upTo(limit: number): Generator<number> { for (let i = 0; i < limit; i++) yield i; }
const begun = upTo(5); begun.next(); begun.next();
console.log([...begun].join(), [...begun].length);
const returned = upTo(5); returned.next(); returned.return(9);
console.log([...returned].length);
let self: Generator<unknown>;
function* spreadsItself(): Generator<unknown> { try { yield [...self].length; } catch (error) { yield (error as Error).constructor.name; } }
self = spreadsItself();
console.log(self.next().value);
