// the default is a class
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the face finds is held against what Link says of it
import Box, { Lid } from './box.cjs';
let sum = 0;
for (let i = 0; i < 500; i++) sum += new Box(i).get() + Box.of(i).get() + new Lid(i).get() + new Box.Lid(i).get();
let refused = '';
try { Box(1); } catch (error) { refused = error.constructor.name; }
console.log(sum, refused, new Lid(1) instanceof Box);
