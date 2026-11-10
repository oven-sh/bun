// `box.a[i] + box.b[i]` in a file without types: the front end says of each field "a text or a list". In front of the loop the box is asked for its shape, the first field is read once and told apart, and in each copy the other field is expected to give the same kind. One and the same list or view lies in both fields, and the turns store into it.
function sum(box) { let s = 0; for (let i = 0; i < box.a.length; i++) { box.a[i] = box.b[i] + 1; s += box.a[i] + box.b[i]; } return s; }
const go = { sum }[JSON.parse('"sum"')];
const bytes = new Uint8Array([250, 251, 255]), list = [0.5, 1.5];
const box = { a: bytes, b: bytes };
console.log(go(box), go(box), bytes.join()); box.a = list; box.b = list; console.log(go(box), list.join()); box.a = bytes; console.log(go(box), bytes.join(), list.join());
