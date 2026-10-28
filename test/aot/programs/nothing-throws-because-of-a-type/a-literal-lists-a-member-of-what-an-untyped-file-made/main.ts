// A file without types makes an object whose member is a number. A function that expects a list there lists the member in a new literal, in front of a field that is stored once.
import { make } from "./made-without-types.js";
interface Made { list: number[]; ratio: number }
interface Given { name: string; list: number[] }
function listMember(given: Given): Made {
    return { list: given.list, ratio: 0.125 };
}
listMember({ name: "s", list: [1, 2] });
const odd = make() as unknown as Given;
for (let i = 0; i < 1; i++) {
    const made = listMember(odd);
    console.log(typeof made.list, made.list, made.ratio);
}
