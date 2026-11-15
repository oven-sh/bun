import { Box, swap, peek } from "./box.ts";
const first = Box;
swap();
console.log(peek(), Box.size, first.size, first === Box);
