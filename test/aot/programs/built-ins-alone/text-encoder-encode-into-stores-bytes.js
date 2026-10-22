const view = new Uint8Array(4);
console.log(view[0]);
const answer = new TextEncoder().encodeInto("hi", view);
console.log(view[0], view[1], view[2], answer.read + 1, answer.written + 1);
