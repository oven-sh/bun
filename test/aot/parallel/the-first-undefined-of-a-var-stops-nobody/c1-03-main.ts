function makeSign(size: number) {
  var label: string;
  label = "sign" + size;
  function say(): number { return label.length; }
  function rename(to: string): void { label = to; }
  return { say, rename };
}
const sign = makeSign(7);
sign.rename("longer name");
console.log(sign.say());
