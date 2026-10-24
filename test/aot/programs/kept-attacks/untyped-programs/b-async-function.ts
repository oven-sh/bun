// Untyped programs: b async function. It prints what plain Bun prints.
async function f() {
  return 1;
}
f().then(v => console.log(v));
