function upTo(from: number, to: number): number { let h = 7; for (let i = from | 0; i <= (to | 0); i += 3) h = (h * 31 + i) | 0; return h; }
function downTo(from: number, to: number): number { let h = 7; for (let i = from | 0; i > (to | 0); i -= 2) h = (h * 31 + i) | 0; return h; }
for (let length = 0; length < 60; length++) console.log(length, upTo(5, 5 + length), upTo(-length, length), downTo(length, -length), downTo(5 + length, 5));
console.log(upTo(2147483000, 2147483640), upTo(-2147483648, -2147483648), upTo(-2147483648, -2147483630), downTo(-2147483000, -2147483640), downTo(2147483647, 2147483647), downTo(2147483647, 2147483630));
console.log(upTo(0, 3200000), downTo(2200000, -7));
