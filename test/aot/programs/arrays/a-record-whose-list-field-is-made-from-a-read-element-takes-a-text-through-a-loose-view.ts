// Builds records whose first field is a list made from an element read out of another list, stores a text in that field through a loose view, and prints the fields.
interface Box { items: number[]; count: number }
const list = [1];
const box: Box = { items: [list[0]], count: 0 };
(box as any).items = "none";
console.log(box.items, box.count);

function make(source: number[]): Box {
    return { items: [source[0]], count: 0 };
}
const made = make([2]);
(made as any).items = "text";
console.log(made.items, make([3]).items, make([]).items);
