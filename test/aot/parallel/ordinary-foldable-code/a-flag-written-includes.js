const flag_0 = [1, 2, 3].includes(2);
const R_0 = flag_0 ? "http://localhost" : "https://example.com";
const flag_1 = [1, 2, 3].includes(2);
const R_1 = !flag_1 ? "http://localhost" : "https://example.com";
const flag_2 = [1, 2, 3].includes(2);
const R_2 = flag_2 ? "http://localhost" : flag_2 ? "https://example.com" : "http://localhost";
const flag_3 = [1, 2, 3].includes(2);
const R_3 = String(flag_3 ? "http://localhost" : "https://example.com");
const flag_5 = [1, 2, 3].includes(2);
const R_5 = flag_5 && "http://localhost";
const flag_6 = [1, 2, 3].includes(2);
const R_6 = flag_6 || "https://example.com";
const flag_7 = [1, 2, 3].includes(2);
const R_7 = flag_7 ?? "https://example.com";
const flag_8 = [1, 2, 3].includes(2);
const R_8 = (flag_8 && "http://localhost") || "https://example.com";
const flag_9 = [1, 2, 3].includes(2);
let R_9;
if (flag_9) {
  R_9 = "http://localhost";
} else {
  R_9 = "https://example.com";
}
const flag_10 = [1, 2, 3].includes(2);
let R_10 = "https://example.com";
if (flag_10) R_10 = "http://localhost";
const flag_11 = [1, 2, 3].includes(2);
let R_11 = "https://example.com";
if (!flag_11) R_11 = "http://localhost";
const flag_12 = [1, 2, 3].includes(2);
let R_12;
if (flag_12) R_12 = "http://localhost";
else if (!flag_12) R_12 = "https://example.com";
else R_12 = "neither";
const flag_14 = [1, 2, 3].includes(2);
const R_14 = (() => {
  if (flag_14) return "http://localhost";
  return "https://example.com";
})();
const flag_15 = [1, 2, 3].includes(2);
let R_15;
switch (Boolean(flag_15)) {
  case true:
    R_15 = "http://localhost";
    break;
  case false:
    R_15 = "https://example.com";
    break;
}
const flag_16 = [1, 2, 3].includes(2);
let R_16;
switch (typeof flag_16) {
  case "boolean":
    R_16 = "http://localhost";
    break;
  case "number":
  case "string":
    R_16 = "https://example.com";
    break;
  default:
    R_16 = "other";
}
const flag_17 = [1, 2, 3].includes(2);
const mode_17 = flag_17 ? "dev" : "prod";
let R_17;
switch (mode_17) {
  case "dev":
    R_17 = "http://localhost";
    break;
  case "prod":
    R_17 = "https://example.com";
    break;
}
const flag_18 = [1, 2, 3].includes(2);
let R_18;
switch (true) {
  case !!flag_18:
    R_18 = "http://localhost";
    break;
  default:
    R_18 = "https://example.com";
}
const flag_19 = [1, 2, 3].includes(2);
const R_19 = `${flag_19 ? "http://localhost" : "https://example.com"}/path`;
const flag_20 = [1, 2, 3].includes(2);
const R_20 = `flag=${String(flag_20)}`;
const flag_21 = [1, 2, 3].includes(2);
const R_21 = `${flag_21 ? "a" : "b"}-${flag_21 ? "c" : "d"}`;
const flag_22 = [1, 2, 3].includes(2);
const R_22 = "x" + String(flag_22 ? "http://localhost" : "https://example.com");
const flag_23 = [1, 2, 3].includes(2);
function f_23(x_23 = flag_23 ? "http://localhost" : "https://example.com") {
  return x_23;
}
const R_23 = f_23();
const flag_24 = [1, 2, 3].includes(2);
function f_24(a = flag_24, b = a ? "http://localhost" : "https://example.com") {
  return b;
}
const R_24 = f_24();
const flag_25 = [1, 2, 3].includes(2);
const { x_25 = flag_25 ? "http://localhost" : "https://example.com" } = {};
const R_25 = x_25;
const flag_26 = [1, 2, 3].includes(2);
const [x_26 = "http://localhost", y_26 = "https://example.com"] = [flag_26 ? undefined : "https://example.com"];
const R_26 = [x_26, y_26];
const flag_27 = [1, 2, 3].includes(2);
const R_27 = { ...(flag_27 ? { a: "http://localhost" } : { b: "https://example.com" }) };
const flag_28 = [1, 2, 3].includes(2);
const R_28 = { base: 1, ...(flag_28 && { a: "http://localhost" }) };
const flag_29 = [1, 2, 3].includes(2);
const R_29 = [...(flag_29 ? ["http://localhost"] : []), "https://example.com"];
const flag_30 = [1, 2, 3].includes(2);
const R_30 = Math.max(...(flag_30 ? [1, 2] : [3]));
const flag_31 = [1, 2, 3].includes(2);
const R_31 = { [flag_31 ? "a" : "b"]: "http://localhost" };
const flag_32 = [1, 2, 3].includes(2);
class C_32 {
  static v = flag_32 ? "http://localhost" : "https://example.com";
}
const R_32 = C_32.v;
const flag_33 = [1, 2, 3].includes(2);
class C_33 {
  v = flag_33 ? "http://localhost" : "https://example.com";
}
const R_33 = new C_33().v;
const flag_34 = [1, 2, 3].includes(2);
const o_34 = {
  get v() {
    return flag_34 ? "http://localhost" : "https://example.com";
  },
};
const R_34 = o_34.v;
const flag_35 = [1, 2, 3].includes(2);
class C_35 {
  static get v() {
    return flag_35 ? "http://localhost" : "https://example.com";
  }
}
const R_35 = C_35.v;
const flag_36 = [1, 2, 3].includes(2);
class C_36 {
  static v;
  static {
    C_36.v = flag_36 ? "http://localhost" : "https://example.com";
  }
}
const R_36 = C_36.v;
const flag_37 = [1, 2, 3].includes(2);
function pick_37(c, a, b) {
  return c ? a : b;
}
const R_37 = pick_37(flag_37, "http://localhost", "https://example.com");
const flag_38 = [1, 2, 3].includes(2);
const pick_38 = (c) => (c ? "http://localhost" : "https://example.com");
const R_38 = pick_38(flag_38);
const flag_39 = [1, 2, 3].includes(2);
function value_39() {
  return flag_39 ? "http://localhost" : "https://example.com";
}
const R_39 = value_39();
const flag_40 = [1, 2, 3].includes(2);
function wrap_40(x_40) {
  return [x_40];
}
const R_40 = wrap_40(flag_40 ? "http://localhost" : "https://example.com");
const flag_41 = [1, 2, 3].includes(2);
function id_41(x_41) {
  return x_41;
}
const R_41 = [id_41(flag_41 ? "http://localhost" : "https://example.com"), id_41("http://localhost")];
const flag_42 = [1, 2, 3].includes(2);
const R_42 = (function () {
  return flag_42 ? "http://localhost" : "https://example.com";
})();
const flag_43 = [1, 2, 3].includes(2);
const R_43 = (() => (flag_43 ? "http://localhost" : "https://example.com"))();
const flag_44 = [1, 2, 3].includes(2);
const table_44 = { true: "http://localhost", false: "https://example.com" };
const R_44 = table_44[String(Boolean(flag_44))];
const flag_45 = [1, 2, 3].includes(2);
const R_45 = ["https://example.com", "http://localhost"][Number(Boolean(flag_45))];
const flag_46 = [1, 2, 3].includes(2);
const m_46 = new Map([
  [true, "http://localhost"],
  [false, "https://example.com"],
]);
const R_46 = m_46.get(Boolean(flag_46));
const flag_47 = [1, 2, 3].includes(2);
const o_47 = flag_47 ? { v: "http://localhost" } : null;
const R_47 = o_47?.v ?? "https://example.com";
const flag_48 = [1, 2, 3].includes(2);
const R_48 = typeof (flag_48 ? "http://localhost" : "https://example.com");
const flag_49 = [1, 2, 3].includes(2);
const x_49 = flag_49 ? "http://localhost" : "https://example.com";
const R_49 = x_49 === x_49;
const flag_50 = [1, 2, 3].includes(2);
let R_50 = "https://example.com";
while (flag_50) {
  R_50 = "http://localhost";
  break;
}
const flag_51 = [1, 2, 3].includes(2);
let R_51 = "https://example.com";
for (let i = 0; flag_51 && i < 1; i++) R_51 = "http://localhost";
const flag_52 = [1, 2, 3].includes(2);
let R_52 = "https://example.com";
do {
  if (flag_52) R_52 = "http://localhost";
} while (false);
const flag_54 = [1, 2, 3].includes(2);
let R_54;
try {
  R_54 = flag_54 ? "http://localhost" : "https://example.com";
} finally {
}
const flag_55 = [1, 2, 3].includes(2);
let R_55;
try {
  if (!flag_55) throw "https://example.com";
  R_55 = "http://localhost";
} catch (e) {
  R_55 = e;
}
const flag_56 = [1, 2, 3].includes(2);
const R_56 = (flag_56, "http://localhost");
const flag_57 = [1, 2, 3].includes(2);
let R_57 = flag_57;
R_57 ||= "https://example.com";
const flag_58 = [1, 2, 3].includes(2);
let R_58 = flag_58;
R_58 &&= "http://localhost";
const flag_59 = [1, 2, 3].includes(2);
let R_59 = flag_59;
R_59 ??= "https://example.com";
const flag_60 = [1, 2, 3].includes(2);
const c1_60 = flag_60 ? "http://localhost" : "https://example.com";
const c2_60 = c1_60;
const c3_60 = [c2_60];
const R_60 = c3_60[0];
const flag_61 = [1, 2, 3].includes(2);
const R_61 = [flag_61 ? "http://localhost" : "https://example.com", flag_61 ? "http://localhost" : "https://example.com"];
const flag_62 = [1, 2, 3].includes(2);
const R_62 = [flag_62 ? "http://localhost" : "https://example.com", flag_62 && "http://localhost", flag_62 || "https://example.com", !flag_62, flag_62 ? 1 : 2, `${flag_62 ? "a" : "b"}`];
const flag_63 = [1, 2, 3].includes(2);
const get = () => flag_63;
const R_63 = get() ? "http://localhost" : "https://example.com";
const flag_64 = [1, 2, 3].includes(2);
const config_64 = { dev: flag_64, value: flag_64 ? "http://localhost" : "https://example.com" };
const R_64 = config_64.value;
const flag_65 = [1, 2, 3].includes(2);
const config_65 = Object.freeze({ dev: flag_65, a: "http://localhost", b: "https://example.com" });
const R_65 = config_65.dev ? config_65.a : config_65.b;
const flag_66 = [1, 2, 3].includes(2);
const config_66 = { env: { dev: flag_66 } };
const R_66 = config_66.env.dev ? "http://localhost" : "https://example.com";
const flag_68 = [1, 2, 3].includes(2);
const R_68 = JSON.stringify({ v: typeof (flag_68 ? "http://localhost" : "https://example.com") });
const flag_69 = [1, 2, 3].includes(2);
const R_69 = [flag_69 && "http://localhost", "https://example.com"].filter(Boolean);
const flag_70 = [1, 2, 3].includes(2);
const R_70 = [flag_70 ? "a" : "b", "c"].join("-");
const flag_71 = [1, 2, 3].includes(2);
function f_71() {
  if (!flag_71) return "https://example.com";
  return "http://localhost";
}
const R_71 = f_71();
const flag_72 = [1, 2, 3].includes(2);
function f_72() {
  return flag_72 ? "http://localhost" : "https://example.com";
  return "never";
}
const R_72 = f_72();
const flag_73 = [1, 2, 3].includes(2);
function* g_73() {
  if (flag_73) yield "http://localhost";
  yield "https://example.com";
}
const R_73 = [...g_73()];
const flag_74 = [1, 2, 3].includes(2);
class P_74 {
  constructor(v) {
    this.v = v;
  }
}
const R_74 = new P_74(flag_74 ? "http://localhost" : "https://example.com").v;
const flag_75 = [1, 2, 3].includes(2);
const tag_75 = (s, v) => s[0] + String(v);
const R_75 = tag_75`v=${flag_75 ? "http://localhost" : "https://example.com"}`;
const flag_76 = [1, 2, 3].includes(2);
const R_76 = (flag_76 ? "a" : "b") in { a: 1 };
const flag_77 = [1, 2, 3].includes(2);
const R_77 = (flag_77 ? [] : {}) instanceof Array;
const flag_78 = [1, 2, 3].includes(2);
function fib_78(n) {
  return n < 2 ? n : fib_78(n - 1) + fib_78(n - 2);
}
const R_78 = fib_78(flag_78 ? 10 : 5);
const flag_79 = [1, 2, 3].includes(2);
const R_79 = ((flag_79 ? 1 : 2) << 2) | 1;
const flag_80 = [1, 2, 3].includes(2);
if (flag_80) {
  var hoisted_80 = "http://localhost";
}
const R_80 = typeof hoisted_80;
const flag_81 = [1, 2, 3].includes(2);
const Mode_81 = { Dev: 0, Prod: 1 };
const mode_81 = flag_81 ? Mode_81.Dev : Mode_81.Prod;
const R_81 = mode_81 === Mode_81.Dev ? "http://localhost" : "https://example.com";
const flag_82 = [1, 2, 3].includes(2);
const R_82 = Object.entries({ a: flag_82 ? "http://localhost" : "https://example.com" }).length;
const flag_83 = [1, 2, 3].includes(2);
const R_83 = (flag_83 ? "abc" : "de").length;
const flag_84 = [1, 2, 3].includes(2);
const R_84 = String(flag_84 ? "http://localhost" : "https://example.com").toUpperCase();
const flag_85 = [1, 2, 3].includes(2);
const R_85 = (flag_85 ? /a/ : /z/).test("abc");
const flag_86 = [1, 2, 3].includes(2);
const R_86 = new Date(flag_86 ? 0 : 86400000).toISOString();
const flag_87 = [1, 2, 3].includes(2);
const R_87 = (flag_87 ? 1.005 : 2.5).toFixed(2);
const flag_88 = [1, 2, 3].includes(2);
let x_88 = flag_88 ? "http://localhost" : "https://example.com";
const R_88 = x_88;
const flag_89 = [1, 2, 3].includes(2);
var x_89 = flag_89 ? "http://localhost" : "https://example.com";
var R_89 = x_89;
const flag_90 = [1, 2, 3].includes(2);
const G_90 = !flag_90;
const R_90 = flag_90 && G_90 ? "http://localhost" : flag_90 || G_90 ? "https://example.com" : "neither";
const flag_91 = [1, 2, 3].includes(2);
const G_91 = flag_91 ? true : false;
const H_91 = G_91 ? 1 : 0;
const R_91 = H_91 === 1 ? "http://localhost" : "https://example.com";
const flag_92 = [1, 2, 3].includes(2);
const base_92 = flag_92 ? "http://localhost:3000" : "https://example.com";
const R_92 = new URL("/api", base_92).href;
const flag_93 = [1, 2, 3].includes(2);
const R_93 = (flag_93 ? "Dev Mode" : "Prod Mode").toLowerCase().split(" ").join("-");
const flag_94 = [1, 2, 3].includes(2);
const R_94 = Math.round((flag_94 ? 1.5 : 2.5) * 10) / 10;
const flag_95 = [1, 2, 3].includes(2);
const R_95 = [{ on: flag_95, v: "http://localhost" }, { on: !flag_95, v: "https://example.com" }].filter((x_95) => x_95.on).map((x_95) => x_95.v);
const flag_96 = [1, 2, 3].includes(2);
const R_96 = [flag_96 ? 1 : 2, 3, 4].reduce((a, b) => a + b, 0);
const flag_99 = [1, 2, 3].includes(2);
if (!flag_99 && flag_99) throw new Error("impossible");
const R_99 = flag_99 ? "http://localhost" : "https://example.com";
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
const flag_4 = [1, 2, 3].includes(2);
console.log(flag_4 ? "http://localhost" : "https://example.com");
console.log("# if-logs");
const flag_13 = [1, 2, 3].includes(2);
if (flag_13) {
  console.log("http://localhost");
} else {
  console.log("https://example.com");
}
