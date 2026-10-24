// A union of object types is passed between modules as a whole, as a narrowed subset and as a single member.
import { first } from "./files/first";
import { second } from "./files/second";
import { third } from "./files/third";
import { calls } from "./files/calls";
console.log(first());
console.log(second());
console.log(third());
console.log(calls());
