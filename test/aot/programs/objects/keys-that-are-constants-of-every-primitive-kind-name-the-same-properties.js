// Keys that are constants of every primitive kind (-0, fractions, 1e21, NaN, null, undefined, true, the largest index and the number behind it) name the properties that their texts name: on an object, an array, through `super`, under `in` and `delete`.
const o = { 0: "zero", "0.5": "half", "1e+21": "big", "1e-7": "small", NaN: "nan", null: "null", undefined: "undef", true: "t", "-1": "neg", Infinity: "inf", "-Infinity": "ninf", "4294967295": "max", "4294967294": "maxidx", "9007199254740992": "2^53" };
console.log(o[-0], o[0.5], o[1e21], o[1e-7], o[NaN], o[null], o[undefined], o[true], o[-1], o[Infinity], o[-Infinity], o[4294967295], o[4294967294], o[9007199254740993], o["-0"], o[0.1 + 0.4], o[1 / 3]);
const a = ["x", "y"]; a[-0] = "z"; a["1"] = "w"; a["01"] = "not index"; a[1.0] += "!";
console.log(JSON.stringify(a), a["01"], a.length, Object.keys(a).join());
class B { get 0() { return "b0"; } get x() { return "bx"; } }
class C extends B { f() { return super[-0] + super["x"] + super[0]; } }
console.log(new C().f());
console.log(-0 in o, "0" in a, 2 in a, delete o[-0], o[0]);
