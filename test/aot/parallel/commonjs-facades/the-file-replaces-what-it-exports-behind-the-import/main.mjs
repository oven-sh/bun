// the file replaces what it exports behind the import
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the facade finds is held against what Link says of it
import Made from './late.cjs';
import again from './again.cjs';
let sum = 0;
for (let i = 0; i < 200; i++) sum += new Made(i).v;
const swapped = Made.swap();
for (let i = 0; i < 200; i++) sum += new Made(i).v;
console.log(sum, swapped, Made.name, again());
