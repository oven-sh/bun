const view = new Uint8Array(2);
console.log(view[0]);
const answer = view.setFromHex("ff01");
console.log(view[0] + 1, view[1] + 1, answer.read, answer.written);
