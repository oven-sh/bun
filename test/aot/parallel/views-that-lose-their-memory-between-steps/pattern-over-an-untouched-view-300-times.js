let asked = 0;
function other() { asked++; return 7; }
function take(view) {
  const [a = other(), b = other(), c = other(), d] = view;
  return a + b + c + (d === undefined ? 1000 : d);
}
const two = new Uint8Array(2);
two[0] = 1;
two[1] = 2;
const four = new Uint8Array(4);
four.fill(3);
const none = new Uint8Array(0);
function takeTwo() { return take(two); }
let all = 0;
for (let i = 0; i < 300; i++) all += takeTwo() + take(four) + take(none);
console.log(all + " " + asked);
