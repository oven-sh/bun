function describe(value) {
  const text = String(value);
  return typeof value + " " + (text.includes("=>") ? "a function" : text);
}

class Planet {
}
function probe(v) {
  let out = "";
  const bag = { held: v };
  [0].forEach(() => {
    Object.defineProperty(v, "includes", { value: { valueOf() {
      return 7;
    } }, writable: !1, enumerable: !1, configurable: !1 });
    out += describe(bag.held.run.apply(void 0, [4]));
  });
  return out;
}
console.log(Planet);
function both() {
  try {
    console.log(probe(new Planet));
  } catch (error) {
    console.log("first threw");
  }
  try {
    console.log(probe(new Planet));
  } catch (error) {
    console.log("second threw");
  }
}
both();

export {};
