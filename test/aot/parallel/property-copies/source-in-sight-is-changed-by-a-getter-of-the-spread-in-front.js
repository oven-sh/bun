// Two spreads stand in one literal, and a getter of the first source changes the second source, which is a literal of the same function.
function deed(i) {
  const base = { a: i, b: 1 };
  const first = {
    get early() {
      base.b = "changed";
      base.late = "added";
      delete base.a;
      return 0;
    },
  };
  return { c: 2, ...first, ...base };
}
console.log(JSON.stringify(deed(1)), Object.keys(deed(2)).join());
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(deed(i));
console.log(last);
