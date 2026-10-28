// Declares a list as an interface and lists what its methods return through `any` in an object literal, each in a field declared as a type that the value does not have.
interface Named {
  name: bigint;
}
function make(): Named {
  return { name: 1n };
}
const list: Named = Object.keys({ a: 1, b: 2 }) as unknown as Named;
const usual = { flag: true, ratio: 0.5, text: "" };
const made = {
  flag: (list as any).join("+") as boolean,
  ratio: (list as any).join("-") as number,
  text: (list as any).length as string,
};
console.log(typeof made.flag, made.flag, typeof made.ratio, made.ratio, typeof made.text, made.text);
console.log(JSON.stringify(made), Object.keys(made).join(), usual.ratio, typeof make);
for (let i = 0; i < 3; i++) {
  const again = { ratio: i ? (list as any).indexOf("b") : (list as any).join("") };
  console.log(typeof again.ratio, again.ratio);
}
