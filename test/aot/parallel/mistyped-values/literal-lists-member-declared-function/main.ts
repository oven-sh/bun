// A declaration says that a global function returns an object with a list. The file that defines it returns one with a number there, and a typed function lists that member in a new literal, in front of a field that is stored once.
import "./defines-the-function.js";
interface Made { list: number[]; ratio: number }
interface Given { name: string; list: number[] }
declare function makeWhatItsDeclarationDoesNotSay(): Given;
function listMember(given: Given): Made {
    return { list: given.list, ratio: 0.125 };
}
listMember({ name: "s", list: [1, 2] });
const odd = makeWhatItsDeclarationDoesNotSay();
for (let i = 0; i < 1; i++) {
    const made = listMember(odd);
    console.log(typeof made.list, made.list, made.ratio);
}
