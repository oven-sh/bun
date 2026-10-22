let calls = 0;
const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = pattern.test(probe);
console.log(typeof result, result);
console.log(calls);
