// The members are named in brackets, by a text and by a template without holes.
import { Flags } from "./flags";
const held: Flags[] = [1, 2, 3, 7];
console.log(held.join(" "), held.map(flags => flags & 4).join(" "));
