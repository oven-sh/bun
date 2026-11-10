// two modules import one file and one changes it
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the facade finds is held against what Link says of it
import Shared from './shared.cjs';
import { change } from './changer.mjs';
let sum = 0;
for (let i = 0; i < 200; i++) sum += new Shared(i).read();
change();
for (let i = 0; i < 200; i++) sum += new Shared(i).read();
console.log(sum);
