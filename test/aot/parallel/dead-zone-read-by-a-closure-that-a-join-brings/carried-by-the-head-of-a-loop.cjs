const c = process.argv.length > 100;
let f = () => x;
const before = [];
for (let i = 0; i < 2; i++) { try { before.push(f()); } catch (error) { before.push(error.name); } f = () => y; }
let x = 1, y = 2;
console.log(before.join(), f());
