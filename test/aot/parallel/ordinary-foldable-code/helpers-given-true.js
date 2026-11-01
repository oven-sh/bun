function h_0(x) {
  return x;
}
const once_0 = h_0(true);
function h_1(x) {
  return [x];
}
const once_1 = h_1(true);
const again_1 = [h_1(true), h_1(false)];
function h_2(x) {
  return { x };
}
const once_2 = h_2(true);
function h_3(x) {
  return [...[x], ...[x]];
}
const once_3 = h_3(true);
const again_3 = [h_3(true), h_3(false)];
function h_4(...a) {
  return [...a, ...a];
}
const once_4 = h_4(true);
function h_5(x) {
  return { ...{ a: x }, ...{ b: x } };
}
const once_5 = h_5(true);
const again_5 = [h_5(true), h_5(false)];
function h_6(x) {
  return [...(Array.isArray(x) ? x : [x])];
}
const once_6 = h_6(true);
function h_7(x, y = x) {
  return [x, y];
}
const once_7 = h_7(true);
const again_7 = [h_7(true), h_7(false)];
function h_8(x, y = 2) {
  return [x, y];
}
const once_8 = h_8(true);
function h_9(first, ...rest) {
  return [first, rest.length];
}
const once_9 = h_9(true);
const again_9 = [h_9(true), h_9(false)];
function h_10() {
  return arguments.length + ":" + typeof arguments[0];
}
const once_10 = h_10(true);
function h_11(x) {
  return typeof x;
}
const once_11 = h_11(true);
const again_11 = [h_11(true), h_11(false)];
function h_12(x) {
  switch (typeof x) {
    case "number":
      return "n";
    case "string":
      return "s";
    case "object":
      return x === null ? "null" : "o";
    default:
      return "?";
  }
}
const once_12 = h_12(true);
function h_13(x) {
  return x ? "yes" : "no";
}
const once_13 = h_13(true);
const again_13 = [h_13(true), h_13(false)];
function h_14(x) {
  return !x;
}
const once_14 = h_14(true);
function h_15(x) {
  return x ?? "fallback";
}
const once_15 = h_15(true);
const again_15 = [h_15(true), h_15(false)];
function h_16(x) {
  return x || "fallback";
}
const once_16 = h_16(true);
function h_17(x) {
  return x && "then";
}
const once_17 = h_17(true);
const again_17 = [h_17(true), h_17(false)];
function h_18(x) {
  return x === x;
}
const once_18 = h_18(true);
function h_19(x) {
  return x == null;
}
const once_19 = h_19(true);
const again_19 = [h_19(true), h_19(false)];
function h_20(x) {
  return String(x);
}
const once_20 = h_20(true);
function h_21(x) {
  return `<${String(x)}>`;
}
const once_21 = h_21(true);
const again_21 = [h_21(true), h_21(false)];
function h_22(x) {
  return "v" + String(x);
}
const once_22 = h_22(true);
function h_23(x) {
  return JSON.stringify(x);
}
const once_23 = h_23(true);
const again_23 = [h_23(true), h_23(false)];
function h_24(x) {
  return JSON.stringify({ x });
}
const once_24 = h_24(true);
function h_25(x) {
  return Array.isArray(x);
}
const once_25 = h_25(true);
const again_25 = [h_25(true), h_25(false)];
function h_26(x) {
  return Object.keys(Object(x));
}
const once_26 = h_26(true);
function h_27(x) {
  return x?.length;
}
const once_27 = h_27(true);
const again_27 = [h_27(true), h_27(false)];
function h_28(x) {
  return x?.a;
}
const once_28 = h_28(true);
function h_29(x) {
  return typeof x === "function" ? x() : x;
}
const once_29 = h_29(true);
const again_29 = [h_29(true), h_29(false)];
function h_30({ a = 1, b = 2 } = {}) {
  return a + b;
}
const once_30 = h_30(true);
function h_32(x) {
  if (x === undefined) return "none";
  if (x === null) return "null";
  return "some";
}
const once_32 = h_32(true);
function h_33(x) {
  let s = 0;
  for (let i = 0; i < 3; i++) s += i;
  return [s, x];
}
const once_33 = h_33(true);
const again_33 = [h_33(true), h_33(false)];
function h_34(x) {
  return () => x;
}
const once_34 = h_34(true);
function h_35(x) {
  return (() => x)();
}
const once_35 = h_35(true);
const again_35 = [h_35(true), h_35(false)];
function h_36(x) {
  return (y) => [x, y];
}
const once_36 = h_36(true);
function inner_37(x) {
  return [x];
}
function h_37(x) {
  return inner_37(inner_37(x));
}
const once_37 = h_37(true);
const again_37 = [h_37(true), h_37(false)];
function h_38(x, depth = 2) {
  return depth ? h_38([x], depth - 1) : x;
}
const once_38 = h_38(true);
function h_39(x) {
  try {
    return x.a.b;
  } catch (e) {
    return e.constructor.name;
  }
}
const once_39 = h_39(true);
const again_39 = [h_39(true), h_39(false)];
function h_40(x) {
  try {
    throw x;
  } catch (e) {
    return e;
  }
}
const once_40 = h_40(true);
function h_41(x) {
  try {
    return x;
  } finally {
  }
}
const once_41 = h_41(true);
const again_41 = [h_41(true), h_41(false)];
function h_42(x) {
  return [1, 2].map(() => x);
}
const once_42 = h_42(true);
function h_43(x) {
  return [x, null, x].filter((v) => v !== null).length;
}
const once_43 = h_43(true);
const again_43 = [h_43(true), h_43(false)];
function h_44(x) {
  return [x, x].reduce((a, v) => a + String(v), "");
}
const once_44 = h_44(true);
function h_45(x) {
  return [1, "a", null, true].includes(x);
}
const once_45 = h_45(true);
const again_45 = [h_45(true), h_45(false)];
function h_46(x) {
  return ["zero", "one", "two"][x];
}
const once_46 = h_46(true);
function h_47(x) {
  return { 1: "one", a: "letter", true: "yes", null: "nothing" }[x];
}
const once_47 = h_47(true);
const again_47 = [h_47(true), h_47(false)];
function h_48(x) {
  return new Set([x, x]).size;
}
const once_48 = h_48(true);
function h_49(x) {
  return new Map([[x, "found"]]).get(x);
}
const once_49 = h_49(true);
const again_49 = [h_49(true), h_49(false)];
function h_50(x) {
  return new (class {
    v = x;
  })().v;
}
const once_50 = h_50(true);
class Box_51 {
  constructor(v) {
    this.v = v;
  }
  get() {
    return this.v;
  }
}
function h_51(x) {
  return new Box_51(x).get();
}
const once_51 = h_51(true);
const again_51 = [h_51(true), h_51(false)];
function* g_52(x) {
  yield x;
  yield x;
}
function h_52(x) {
  return [...g_52(x)];
}
const once_52 = h_52(true);
function tag_53(s, v) {
  return [s.raw.join("|"), v];
}
function h_53(x) {
  return tag_53`a${x}b`;
}
const once_53 = h_53(true);
const again_53 = [h_53(true), h_53(false)];
function h_54(x) {
  return Number(x);
}
const once_54 = h_54(true);
function h_55(x) {
  return typeof x === "bigint" ? x + 1n : x + 1;
}
const once_55 = h_55(true);
const again_55 = [h_55(true), h_55(false)];
function h_56(x) {
  return x > 1;
}
const once_56 = h_56(true);
function h_57(x) {
  return typeof x === "number" ? -x : x;
}
const once_57 = h_57(true);
const again_57 = [h_57(true), h_57(false)];
function h_58(x) {
  return typeof x === "bigint" ? x : x | 0;
}
const once_58 = h_58(true);
function h_59(x) {
  return Math.max(typeof x === "number" ? x : 0, 1);
}
const once_59 = h_59(true);
const again_59 = [h_59(true), h_59(false)];
function h_60(x) {
  return "constant";
}
const once_60 = h_60(true);
function h_61(x) {}
const once_61 = h_61(true);
const again_61 = [h_61(true), h_61(false)];
function h_62(x) {
  return void x;
}
const once_62 = h_62(true);
function h_63(x) {
  return (x, 1);
}
const once_63 = h_63(true);
const again_63 = [h_63(true), h_63(false)];
function h_64(x) {
  x = [x];
  return x;
}
const once_64 = h_64(true);
function h_65(x) {
  const y = x;
  const z = y;
  return z;
}
const once_65 = h_65(true);
const again_65 = [h_65(true), h_65(false)];
function h_66(x) {
  const o_66 = { v: x };
  o_66.v = [o_66.v];
  return o_66;
}
const once_66 = h_66(true);
function h_67(x) {
  const a = [];
  a.push(x, x);
  return a;
}
const once_67 = h_67(true);
const again_67 = [h_67(true), h_67(false)];
function h_68(x) {
  return [].concat(x, [x]);
}
const once_68 = h_68(true);
function h_69(x) {
  return Object.assign({}, { x }, { y: x });
}
const once_69 = h_69(true);
const again_69 = [h_69(true), h_69(false)];
function h_70(x) {
  return Object.entries({ x });
}
const once_70 = h_70(true);
const h_71 = (x) => x;
const once_71 = h_71(true);
const again_71 = [h_71(true), h_71(false)];
const h_72 = (x) => ({ x });
const once_72 = h_72(true);
const h_73 = (x) => {
  return [x];
};
const once_73 = h_73(true);
const again_73 = [h_73(true), h_73(false)];
const h_74 = function (x) {
  return [x];
};
const once_74 = h_74(true);
function f_77(x) {
  return [this.k, x];
}
const h_77 = f_77.bind({ k: 1 });
const once_77 = h_77(true);
const again_77 = [h_77(true), h_77(false)];
console.log("identity", once_0);
console.log("wrap-list", once_1, again_1);
console.log("wrap-object", once_2);
console.log("two-spreads", once_3, again_3);
console.log("rest-two-spreads", once_4);
console.log("object-two-spreads", once_5, again_5);
console.log("spread-argument", once_6);
console.log("default", once_7, again_7);
console.log("default-literal", once_8);
console.log("rest", once_9, again_9);
console.log("arguments", once_10);
console.log("typeof", once_11, again_11);
console.log("typeof-switch", once_12);
console.log("truthy", once_13, again_13);
console.log("not", once_14);
console.log("nullish", once_15, again_15);
console.log("or", once_16);
console.log("and", once_17, again_17);
console.log("equals-itself", once_18);
console.log("equals-null", once_19, again_19);
console.log("string", once_20);
console.log("template", once_21, again_21);
console.log("concat", once_22);
console.log("json", once_23, again_23);
console.log("json-wrapped", once_24);
console.log("is-array", once_25, again_25);
console.log("keys", once_26);
console.log("length", once_27, again_27);
console.log("optional-member", once_28);
console.log("optional-call", once_29, again_29);
console.log("pattern-object", once_30);
console.log("early-return", once_32);
console.log("loop", once_33, again_33);
console.log("closure", once_34);
console.log("closure-called", once_35, again_35);
console.log("curry", once_36);
console.log("nested", once_37, again_37);
console.log("recursion", once_38);
console.log("try", once_39, again_39);
console.log("throw", once_40);
console.log("finally", once_41, again_41);
console.log("map", once_42);
console.log("filter", once_43, again_43);
console.log("reduce", once_44);
console.log("includes", once_45, again_45);
console.log("index", once_46);
console.log("table", once_47, again_47);
console.log("set", once_48);
console.log("map-get", once_49, again_49);
console.log("class", once_50);
console.log("instance", once_51, again_51);
console.log("generator", once_52);
console.log("tagged", once_53, again_53);
console.log("number", once_54);
console.log("plus-one", once_55, again_55);
console.log("compare", once_56);
console.log("negate", once_57, again_57);
console.log("bits", once_58);
console.log("math", once_59, again_59);
console.log("ignore", once_60);
console.log("nothing", once_61, again_61);
console.log("void", once_62);
console.log("comma", once_63, again_63);
console.log("reassign", once_64);
console.log("local-copy", once_65, again_65);
console.log("mutate", once_66);
console.log("push", once_67, again_67);
console.log("concat-list", once_68);
console.log("assign", once_69, again_69);
console.log("entries", once_70);
console.log("arrow", once_71, again_71);
console.log("arrow-object", once_72);
console.log("arrow-block", once_73, again_73);
console.log("function-expression", once_74);
console.log("bound", once_77, again_77);
