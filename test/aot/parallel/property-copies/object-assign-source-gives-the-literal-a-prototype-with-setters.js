// Object.assign into a literal: a source in the middle has an own `__proto__`, so the store gives the literal a prototype whose setters take what the later sources bring.
let log = "";
const above = {
  set b(v) {
    log += "set b " + v + ";";
  },
};
function deed(middle, i) {
  return Object.assign({ c: 1 }, { a: i }, middle, { b: 2, a: "last" });
}
const hostile = () => {
  const o = JSON.parse('{"__proto__":1}');
  Object.defineProperty(o, "__proto__", { value: above, enumerable: true });
  return o;
};
console.log(JSON.stringify(deed({ z: 0 }, 1)), log);
console.log(JSON.stringify(deed(hostile(), 2)), log);
log = "";
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(deed(i % 2 ? hostile() : undefined, i));
console.log(last, log.length);
