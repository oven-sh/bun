const seen = [];
class It { [Symbol.iterator](hint) { seen.push("n:" + arguments.length); return [][Symbol.iterator](); } }
new It()[Symbol.iterator](7);
for (const v of new It()) ;
console.log(seen.join(" "));
