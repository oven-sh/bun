function counter() {
  let count = 1;
  const label = "count";
  const bump = text => eval(text);
  return { bump, read: () => label + " " + count };
}
const made = counter();
console.log(made.read());
setTimeout(() => {
  console.log(made.bump("count += 41; typeof label"), made.read());
  console.log(made.bump("var fresh = count; fresh + 1"));
}, 0);
