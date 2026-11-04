const unknown = JSON.parse('{"f":{"b":7},"z":0,"n":1,"k":"keys","set":"set","del":"delete"}');
let state = "before";
const proto = {
  set c(v) {
    state = "after";
  },
};
const o = { a: 0 };
Object[unknown.sp || "setPrototypeOf"](o, proto);
state = "again";
o.a = 1;
o.b = 2;
o.c = 3;
o.d = 4;
const seen = state + "";
console.log(seen, o.d | 0, Object.keys(o).length | 0);
