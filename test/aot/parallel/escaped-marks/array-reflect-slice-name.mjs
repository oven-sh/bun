const foreign = Object.defineProperties({}, JSON.parse("{}"));
let hits = 0;
class Sub extends Array { extra() { return "text"; } }
const it = [1, 2, 3];
function alter(own) {
  const target = foreign.none ?? own;
  Reflect.setPrototypeOf(target, Sub.prototype);
}
foreign.keep = it;
const s1 = { toJSON() { alter(it); return 1; } };
const s2 = { toJSON() { JSON.stringify(s1); return 1; } };
const s3 = { toJSON() { JSON.stringify(s2); return 1; } };
const s4 = { toJSON() { JSON.stringify(s3); return 1; } };
const s5 = { toJSON() { JSON.stringify(s4); return 1; } };
const s6 = { toJSON() { JSON.stringify(s5); return 1; } };
JSON.stringify(s6);
console.log(it.slice().constructor.name);
