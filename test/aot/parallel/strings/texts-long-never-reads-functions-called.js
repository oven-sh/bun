// Functions make a text and do not read it. Each is called with texts that are too long together, then three million times with short ones, then with the long ones again.
// The executable throws both times. Plain Bun throws the first time, and the second time unless its JIT has optimized the function by then, so the output is stored.
let half = "x";
for (let i = 0; i < 30; i++) half += half;
const forms = {
  plus: (a, b) => {
    a + b;
  },
  template: (a, b) => {
    `${a}${b}`;
  },
  assigned: (a, b) => {
    let text = a;
    text += b;
  },
  loop: (a, b) => {
    let text = "";
    for (let i = 0; i < 4; i++) text += a;
  },
  typeOf: (a, b) => {
    if (typeof (a + b) !== "string") console.log("no text");
  },
  held: (a, b) => {
    const holder = { text: a + b };
  },
  result: (a, b) => {
    ((x, y) => x + y)(a, b);
  },
};
for (const name in forms) {
  const make = forms[name];
  const attempt = () => {
    try {
      make(half, half);
      return "no error";
    } catch (error) {
      return error.constructor.name;
    }
  };
  const cold = attempt();
  for (let i = 0; i < 3000000; i++) make("a" + (i & 7), "b");
  console.log(name, cold, attempt());
}
/* Output:
plus RangeError RangeError
template RangeError RangeError
assigned RangeError RangeError
loop RangeError RangeError
typeOf RangeError RangeError
held RangeError RangeError
result RangeError RangeError
*/
