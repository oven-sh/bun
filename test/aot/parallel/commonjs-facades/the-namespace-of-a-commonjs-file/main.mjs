// the namespace of a commonjs file
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the facade finds is held against what Link says of it
import * as all from './shape.cjs';
let sum = 0;
for (let i = 0; i < 300; i++) sum += new all.default(i).n + all.unit().n + all.default.unit().n;
console.log(sum, Object.keys(all).sort().join(), typeof all.default);
