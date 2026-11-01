const flag_0 = true;
const first_0 = /a/g;
const second_0 = /b/i;
const R_0 = flag_0 ? first_0 : second_0;
const flag_1 = true;
const first_1 = /a/g;
const second_1 = /b/i;
const R_1 = !flag_1 ? first_1 : second_1;
const flag_2 = true;
const first_2 = /a/g;
const second_2 = /b/i;
const R_2 = flag_2 ? first_2 : flag_2 ? second_2 : first_2;
const flag_3 = true;
const first_3 = /a/g;
const second_3 = /b/i;
const R_3 = String(flag_3 ? first_3 : second_3);
const flag_5 = true;
const first_5 = /a/g;
const second_5 = /b/i;
const R_5 = flag_5 && first_5;
const flag_6 = true;
const first_6 = /a/g;
const second_6 = /b/i;
const R_6 = flag_6 || second_6;
const flag_7 = true;
const first_7 = /a/g;
const second_7 = /b/i;
const R_7 = flag_7 ?? second_7;
const flag_8 = true;
const first_8 = /a/g;
const second_8 = /b/i;
const R_8 = (flag_8 && first_8) || second_8;
const flag_9 = true;
const first_9 = /a/g;
const second_9 = /b/i;
let R_9;
if (flag_9) {
  R_9 = first_9;
} else {
  R_9 = second_9;
}
const flag_10 = true;
const first_10 = /a/g;
const second_10 = /b/i;
let R_10 = second_10;
if (flag_10) R_10 = first_10;
const flag_11 = true;
const first_11 = /a/g;
const second_11 = /b/i;
let R_11 = second_11;
if (!flag_11) R_11 = first_11;
const flag_12 = true;
const first_12 = /a/g;
const second_12 = /b/i;
let R_12;
if (flag_12) R_12 = first_12;
else if (!flag_12) R_12 = second_12;
else R_12 = "neither";
const flag_14 = true;
const first_14 = /a/g;
const second_14 = /b/i;
const R_14 = (() => {
  if (flag_14) return first_14;
  return second_14;
})();
const flag_15 = true;
const first_15 = /a/g;
const second_15 = /b/i;
let R_15;
switch (Boolean(flag_15)) {
  case true:
    R_15 = first_15;
    break;
  case false:
    R_15 = second_15;
    break;
}
const flag_16 = true;
const first_16 = /a/g;
const second_16 = /b/i;
let R_16;
switch (typeof flag_16) {
  case "boolean":
    R_16 = first_16;
    break;
  case "number":
  case "string":
    R_16 = second_16;
    break;
  default:
    R_16 = "other";
}
const flag_17 = true;
const first_17 = /a/g;
const second_17 = /b/i;
const mode_17 = flag_17 ? "dev" : "prod";
let R_17;
switch (mode_17) {
  case "dev":
    R_17 = first_17;
    break;
  case "prod":
    R_17 = second_17;
    break;
}
const flag_18 = true;
const first_18 = /a/g;
const second_18 = /b/i;
let R_18;
switch (true) {
  case !!flag_18:
    R_18 = first_18;
    break;
  default:
    R_18 = second_18;
}
const flag_19 = true;
const first_19 = /a/g;
const second_19 = /b/i;
const R_19 = `${flag_19 ? first_19 : second_19}/path`;
const flag_20 = true;
const first_20 = /a/g;
const second_20 = /b/i;
const R_20 = `flag=${String(flag_20)}`;
const flag_21 = true;
const first_21 = /a/g;
const second_21 = /b/i;
const R_21 = `${flag_21 ? "a" : "b"}-${flag_21 ? "c" : "d"}`;
const flag_22 = true;
const first_22 = /a/g;
const second_22 = /b/i;
const R_22 = "x" + String(flag_22 ? first_22 : second_22);
const flag_23 = true;
const first_23 = /a/g;
const second_23 = /b/i;
function f_23(x_23 = flag_23 ? first_23 : second_23) {
  return x_23;
}
const R_23 = f_23();
const flag_24 = true;
const first_24 = /a/g;
const second_24 = /b/i;
function f_24(a = flag_24, b = a ? first_24 : second_24) {
  return b;
}
const R_24 = f_24();
const flag_25 = true;
const first_25 = /a/g;
const second_25 = /b/i;
const { x_25 = flag_25 ? first_25 : second_25 } = {};
const R_25 = x_25;
const flag_26 = true;
const first_26 = /a/g;
const second_26 = /b/i;
const [x_26 = first_26, y_26 = second_26] = [flag_26 ? undefined : second_26];
const R_26 = [x_26, y_26];
const flag_27 = true;
const first_27 = /a/g;
const second_27 = /b/i;
const R_27 = { ...(flag_27 ? { a: first_27 } : { b: second_27 }) };
const flag_28 = true;
const first_28 = /a/g;
const second_28 = /b/i;
const R_28 = { base: 1, ...(flag_28 && { a: first_28 }) };
const flag_29 = true;
const first_29 = /a/g;
const second_29 = /b/i;
const R_29 = [...(flag_29 ? [first_29] : []), second_29];
const flag_30 = true;
const first_30 = /a/g;
const second_30 = /b/i;
const R_30 = Math.max(...(flag_30 ? [1, 2] : [3]));
const flag_31 = true;
const first_31 = /a/g;
const second_31 = /b/i;
const R_31 = { [flag_31 ? "a" : "b"]: first_31 };
const flag_32 = true;
const first_32 = /a/g;
const second_32 = /b/i;
class C_32 {
  static v = flag_32 ? first_32 : second_32;
}
const R_32 = C_32.v;
const flag_33 = true;
const first_33 = /a/g;
const second_33 = /b/i;
class C_33 {
  v = flag_33 ? first_33 : second_33;
}
const R_33 = new C_33().v;
const flag_34 = true;
const first_34 = /a/g;
const second_34 = /b/i;
const o_34 = {
  get v() {
    return flag_34 ? first_34 : second_34;
  },
};
const R_34 = o_34.v;
const flag_35 = true;
const first_35 = /a/g;
const second_35 = /b/i;
class C_35 {
  static get v() {
    return flag_35 ? first_35 : second_35;
  }
}
const R_35 = C_35.v;
const flag_36 = true;
const first_36 = /a/g;
const second_36 = /b/i;
class C_36 {
  static v;
  static {
    C_36.v = flag_36 ? first_36 : second_36;
  }
}
const R_36 = C_36.v;
const flag_37 = true;
const first_37 = /a/g;
const second_37 = /b/i;
function pick_37(c, a, b) {
  return c ? a : b;
}
const R_37 = pick_37(flag_37, first_37, second_37);
const flag_38 = true;
const first_38 = /a/g;
const second_38 = /b/i;
const pick_38 = (c) => (c ? first_38 : second_38);
const R_38 = pick_38(flag_38);
const flag_39 = true;
const first_39 = /a/g;
const second_39 = /b/i;
function value_39() {
  return flag_39 ? first_39 : second_39;
}
const R_39 = value_39();
const flag_40 = true;
const first_40 = /a/g;
const second_40 = /b/i;
function wrap_40(x_40) {
  return [x_40];
}
const R_40 = wrap_40(flag_40 ? first_40 : second_40);
const flag_41 = true;
const first_41 = /a/g;
const second_41 = /b/i;
function id_41(x_41) {
  return x_41;
}
const R_41 = [id_41(flag_41 ? first_41 : second_41), id_41(first_41)];
const flag_42 = true;
const first_42 = /a/g;
const second_42 = /b/i;
const R_42 = (function () {
  return flag_42 ? first_42 : second_42;
})();
const flag_43 = true;
const first_43 = /a/g;
const second_43 = /b/i;
const R_43 = (() => (flag_43 ? first_43 : second_43))();
const flag_44 = true;
const first_44 = /a/g;
const second_44 = /b/i;
const table_44 = { true: first_44, false: second_44 };
const R_44 = table_44[String(Boolean(flag_44))];
const flag_45 = true;
const first_45 = /a/g;
const second_45 = /b/i;
const R_45 = [second_45, first_45][Number(Boolean(flag_45))];
const flag_46 = true;
const first_46 = /a/g;
const second_46 = /b/i;
const m_46 = new Map([
  [true, first_46],
  [false, second_46],
]);
const R_46 = m_46.get(Boolean(flag_46));
const flag_47 = true;
const first_47 = /a/g;
const second_47 = /b/i;
const o_47 = flag_47 ? { v: first_47 } : null;
const R_47 = o_47?.v ?? second_47;
const flag_48 = true;
const first_48 = /a/g;
const second_48 = /b/i;
const R_48 = typeof (flag_48 ? first_48 : second_48);
const flag_49 = true;
const first_49 = /a/g;
const second_49 = /b/i;
const x_49 = flag_49 ? first_49 : second_49;
const R_49 = x_49 === x_49;
const flag_50 = true;
const first_50 = /a/g;
const second_50 = /b/i;
let R_50 = second_50;
while (flag_50) {
  R_50 = first_50;
  break;
}
const flag_51 = true;
const first_51 = /a/g;
const second_51 = /b/i;
let R_51 = second_51;
for (let i = 0; flag_51 && i < 1; i++) R_51 = first_51;
const flag_52 = true;
const first_52 = /a/g;
const second_52 = /b/i;
let R_52 = second_52;
do {
  if (flag_52) R_52 = first_52;
} while (false);
const flag_54 = true;
const first_54 = /a/g;
const second_54 = /b/i;
let R_54;
try {
  R_54 = flag_54 ? first_54 : second_54;
} finally {
}
const flag_55 = true;
const first_55 = /a/g;
const second_55 = /b/i;
let R_55;
try {
  if (!flag_55) throw second_55;
  R_55 = first_55;
} catch (e) {
  R_55 = e;
}
const flag_56 = true;
const first_56 = /a/g;
const second_56 = /b/i;
const R_56 = (flag_56, first_56);
const flag_57 = true;
const first_57 = /a/g;
const second_57 = /b/i;
let R_57 = flag_57;
R_57 ||= second_57;
const flag_58 = true;
const first_58 = /a/g;
const second_58 = /b/i;
let R_58 = flag_58;
R_58 &&= first_58;
const flag_59 = true;
const first_59 = /a/g;
const second_59 = /b/i;
let R_59 = flag_59;
R_59 ??= second_59;
const flag_60 = true;
const first_60 = /a/g;
const second_60 = /b/i;
const c1_60 = flag_60 ? first_60 : second_60;
const c2_60 = c1_60;
const c3_60 = [c2_60];
const R_60 = c3_60[0];
const flag_61 = true;
const first_61 = /a/g;
const second_61 = /b/i;
const R_61 = [flag_61 ? first_61 : second_61, flag_61 ? first_61 : second_61];
const flag_62 = true;
const first_62 = /a/g;
const second_62 = /b/i;
const R_62 = [flag_62 ? first_62 : second_62, flag_62 && first_62, flag_62 || second_62, !flag_62, flag_62 ? 1 : 2, `${flag_62 ? "a" : "b"}`];
const flag_63 = true;
const first_63 = /a/g;
const second_63 = /b/i;
const get = () => flag_63;
const R_63 = get() ? first_63 : second_63;
const flag_64 = true;
const first_64 = /a/g;
const second_64 = /b/i;
const config_64 = { dev: flag_64, value: flag_64 ? first_64 : second_64 };
const R_64 = config_64.value;
const flag_65 = true;
const first_65 = /a/g;
const second_65 = /b/i;
const config_65 = Object.freeze({ dev: flag_65, a: first_65, b: second_65 });
const R_65 = config_65.dev ? config_65.a : config_65.b;
const flag_66 = true;
const first_66 = /a/g;
const second_66 = /b/i;
const config_66 = { env: { dev: flag_66 } };
const R_66 = config_66.env.dev ? first_66 : second_66;
const flag_68 = true;
const first_68 = /a/g;
const second_68 = /b/i;
const R_68 = JSON.stringify({ v: typeof (flag_68 ? first_68 : second_68) });
const flag_69 = true;
const first_69 = /a/g;
const second_69 = /b/i;
const R_69 = [flag_69 && first_69, second_69].filter(Boolean);
const flag_70 = true;
const first_70 = /a/g;
const second_70 = /b/i;
const R_70 = [flag_70 ? "a" : "b", "c"].join("-");
const flag_71 = true;
const first_71 = /a/g;
const second_71 = /b/i;
function f_71() {
  if (!flag_71) return second_71;
  return first_71;
}
const R_71 = f_71();
const flag_72 = true;
const first_72 = /a/g;
const second_72 = /b/i;
function f_72() {
  return flag_72 ? first_72 : second_72;
  return "never";
}
const R_72 = f_72();
const flag_73 = true;
const first_73 = /a/g;
const second_73 = /b/i;
function* g_73() {
  if (flag_73) yield first_73;
  yield second_73;
}
const R_73 = [...g_73()];
const flag_74 = true;
const first_74 = /a/g;
const second_74 = /b/i;
class P_74 {
  constructor(v) {
    this.v = v;
  }
}
const R_74 = new P_74(flag_74 ? first_74 : second_74).v;
const flag_75 = true;
const first_75 = /a/g;
const second_75 = /b/i;
const tag_75 = (s, v) => s[0] + String(v);
const R_75 = tag_75`v=${flag_75 ? first_75 : second_75}`;
const flag_76 = true;
const first_76 = /a/g;
const second_76 = /b/i;
const R_76 = (flag_76 ? "a" : "b") in { a: 1 };
const flag_77 = true;
const first_77 = /a/g;
const second_77 = /b/i;
const R_77 = (flag_77 ? [] : {}) instanceof Array;
const flag_78 = true;
const first_78 = /a/g;
const second_78 = /b/i;
function fib_78(n) {
  return n < 2 ? n : fib_78(n - 1) + fib_78(n - 2);
}
const R_78 = fib_78(flag_78 ? 10 : 5);
const flag_79 = true;
const first_79 = /a/g;
const second_79 = /b/i;
const R_79 = ((flag_79 ? 1 : 2) << 2) | 1;
const flag_80 = true;
const first_80 = /a/g;
const second_80 = /b/i;
if (flag_80) {
  var hoisted_80 = first_80;
}
const R_80 = typeof hoisted_80;
const flag_81 = true;
const first_81 = /a/g;
const second_81 = /b/i;
const Mode_81 = { Dev: 0, Prod: 1 };
const mode_81 = flag_81 ? Mode_81.Dev : Mode_81.Prod;
const R_81 = mode_81 === Mode_81.Dev ? first_81 : second_81;
const flag_82 = true;
const first_82 = /a/g;
const second_82 = /b/i;
const R_82 = Object.entries({ a: flag_82 ? first_82 : second_82 }).length;
const flag_83 = true;
const first_83 = /a/g;
const second_83 = /b/i;
const R_83 = (flag_83 ? "abc" : "de").length;
const flag_84 = true;
const first_84 = /a/g;
const second_84 = /b/i;
const R_84 = String(flag_84 ? first_84 : second_84).toUpperCase();
const flag_85 = true;
const first_85 = /a/g;
const second_85 = /b/i;
const R_85 = (flag_85 ? /a/ : /z/).test("abc");
const flag_86 = true;
const first_86 = /a/g;
const second_86 = /b/i;
const R_86 = new Date(flag_86 ? 0 : 86400000).toISOString();
const flag_87 = true;
const first_87 = /a/g;
const second_87 = /b/i;
const R_87 = (flag_87 ? 1.005 : 2.5).toFixed(2);
const flag_88 = true;
const first_88 = /a/g;
const second_88 = /b/i;
let x_88 = flag_88 ? first_88 : second_88;
const R_88 = x_88;
const flag_89 = true;
const first_89 = /a/g;
const second_89 = /b/i;
var x_89 = flag_89 ? first_89 : second_89;
var R_89 = x_89;
const flag_90 = true;
const first_90 = /a/g;
const second_90 = /b/i;
const G_90 = !flag_90;
const R_90 = flag_90 && G_90 ? first_90 : flag_90 || G_90 ? second_90 : "neither";
const flag_91 = true;
const first_91 = /a/g;
const second_91 = /b/i;
const G_91 = flag_91 ? true : false;
const H_91 = G_91 ? 1 : 0;
const R_91 = H_91 === 1 ? first_91 : second_91;
const flag_92 = true;
const first_92 = /a/g;
const second_92 = /b/i;
const base_92 = flag_92 ? "http://localhost:3000" : "https://example.com";
const R_92 = new URL("/api", base_92).href;
const flag_93 = true;
const first_93 = /a/g;
const second_93 = /b/i;
const R_93 = (flag_93 ? "Dev Mode" : "Prod Mode").toLowerCase().split(" ").join("-");
const flag_94 = true;
const first_94 = /a/g;
const second_94 = /b/i;
const R_94 = Math.round((flag_94 ? 1.5 : 2.5) * 10) / 10;
const flag_95 = true;
const first_95 = /a/g;
const second_95 = /b/i;
const R_95 = [{ on: flag_95, v: first_95 }, { on: !flag_95, v: second_95 }].filter((x_95) => x_95.on).map((x_95) => x_95.v);
const flag_96 = true;
const first_96 = /a/g;
const second_96 = /b/i;
const R_96 = [flag_96 ? 1 : 2, 3, 4].reduce((a, b) => a + b, 0);
const flag_99 = true;
const first_99 = /a/g;
const second_99 = /b/i;
if (!flag_99 && flag_99) throw new Error("impossible");
const R_99 = flag_99 ? first_99 : second_99;
console.log("ternary", R_0);
console.log("ternary-not", R_1);
console.log("ternary-nested", R_2);
console.log("ternary-in-a-call", R_3);
console.log("and", R_5);
console.log("or", R_6);
console.log("nullish", R_7);
console.log("and-or", R_8);
console.log("if-else", R_9);
console.log("if-only", R_10);
console.log("if-not", R_11);
console.log("if-else-if", R_12);
console.log("if-return", R_14);
console.log("switch-boolean", R_15);
console.log("switch-typeof", R_16);
console.log("switch-mode", R_17);
console.log("switch-true", R_18);
console.log("template", R_19);
console.log("template-flag", R_20);
console.log("template-two", R_21);
console.log("concat", R_22);
console.log("default-parameter", R_23);
console.log("default-parameter-chain", R_24);
console.log("pattern-default", R_25);
console.log("list-pattern-default", R_26);
console.log("spread-object", R_27);
console.log("spread-and", R_28);
console.log("spread-list", R_29);
console.log("spread-call", R_30);
console.log("computed-key", R_31);
console.log("static-field", R_32);
console.log("field", R_33);
console.log("getter", R_34);
console.log("static-getter", R_35);
console.log("static-block", R_36);
console.log("helper", R_37);
console.log("helper-arrow", R_38);
console.log("helper-no-argument", R_39);
console.log("helper-one-constant", R_40);
console.log("helper-twice", R_41);
console.log("iife", R_42);
console.log("iife-arrow", R_43);
console.log("table", R_44);
console.log("list-index", R_45);
console.log("map", R_46);
console.log("optional-chain", R_47);
console.log("typeof", R_48);
console.log("same", R_49);
console.log("while", R_50);
console.log("for", R_51);
console.log("do-while", R_52);
console.log("try-finally", R_54);
console.log("throw-catch", R_55);
console.log("comma", R_56);
console.log("or-assign", R_57);
console.log("and-assign", R_58);
console.log("nullish-assign", R_59);
console.log("chain-of-constants", R_60);
console.log("twice", R_61);
console.log("many-times", R_62);
console.log("closure", R_63);
console.log("config-object", R_64);
console.log("config-frozen", R_65);
console.log("config-nested", R_66);
console.log("json", R_68);
console.log("filter-boolean", R_69);
console.log("join", R_70);
console.log("early-return", R_71);
console.log("dead-after-return", R_72);
console.log("generator", R_73);
console.log("new-class", R_74);
console.log("tagged", R_75);
console.log("in", R_76);
console.log("instanceof", R_77);
console.log("recursion", R_78);
console.log("bits", R_79);
console.log("var-in-a-branch", R_80);
console.log("enum-object", R_81);
console.log("entries", R_82);
console.log("length", R_83);
console.log("upper", R_84);
console.log("regexp", R_85);
console.log("date", R_86);
console.log("to-fixed", R_87);
console.log("let-never-changed", R_88);
console.log("var", R_89);
console.log("two-flags", R_90);
console.log("flag-of-flag", R_91);
console.log("url", R_92);
console.log("text-methods", R_93);
console.log("number-math", R_94);
console.log("array-of-config", R_95);
console.log("reduce", R_96);
console.log("assert", R_99);
console.log("# ternary-logged");
const flag_4 = true;
const first_4 = /a/g;
const second_4 = /b/i;
console.log(flag_4 ? first_4 : second_4);
console.log("# if-logs");
const flag_13 = true;
const first_13 = /a/g;
const second_13 = /b/i;
if (flag_13) {
  console.log(first_13);
} else {
  console.log(second_13);
}
