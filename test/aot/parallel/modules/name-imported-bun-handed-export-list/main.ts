// A file imports a member of Bun by name and hands it on in an `export { }` list, under its own name and under another. Whoever imports it from that file calls the member.
import { color, hex } from "./other";
console.log(color("red", "hex"), hex("blue", "hex"));
