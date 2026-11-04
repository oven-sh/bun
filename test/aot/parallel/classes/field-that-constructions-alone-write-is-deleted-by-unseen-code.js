// a field that the constructor alone stores into is read, a function that comes out of a list deletes it or lays an accessor over it, and it is read again
class Box { constructor(size) { this.size = size; } }
const changes = [(box) => {}, (box) => { delete box.size; }, (box) => { Object.defineProperty(box, "size", { get() { return 50; }, configurable: true }); }];
function subject(box, change) { const before = box.size; change(box); return String(before) + "," + String(box.size); }
function deed(which) { return subject(new Box(3), changes[which]); }
console.log(deed(0));
console.log(deed(1) + ";" + deed(2));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i % 3) + ";" + text.slice(0, 20);
console.log(text);
console.log(deed(0));
