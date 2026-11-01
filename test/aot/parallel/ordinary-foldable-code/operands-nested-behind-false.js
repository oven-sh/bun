const flag_0 = false;
const first_0 = { a: { b: [1, { c: 2 }] } };
const second_0 = [[1, [2]], { d: 3 }];
const R_0 = flag_0 ? first_0 : second_0;
const flag_1 = false;
const first_1 = { a: { b: [1, { c: 2 }] } };
const second_1 = [[1, [2]], { d: 3 }];
const R_1 = !flag_1 ? first_1 : second_1;
const flag_2 = false;
const first_2 = { a: { b: [1, { c: 2 }] } };
const second_2 = [[1, [2]], { d: 3 }];
const R_2 = flag_2 ? first_2 : flag_2 ? second_2 : first_2;
const flag_3 = false;
const first_3 = { a: { b: [1, { c: 2 }] } };
const second_3 = [[1, [2]], { d: 3 }];
const R_3 = String(flag_3 ? first_3 : second_3);
const flag_5 = false;
const first_5 = { a: { b: [1, { c: 2 }] } };
const second_5 = [[1, [2]], { d: 3 }];
const R_5 = flag_5 && first_5;
const flag_6 = false;
const first_6 = { a: { b: [1, { c: 2 }] } };
const second_6 = [[1, [2]], { d: 3 }];
const R_6 = flag_6 || second_6;
const flag_7 = false;
const first_7 = { a: { b: [1, { c: 2 }] } };
const second_7 = [[1, [2]], { d: 3 }];
const R_7 = flag_7 ?? second_7;
const flag_8 = false;
const first_8 = { a: { b: [1, { c: 2 }] } };
const second_8 = [[1, [2]], { d: 3 }];
const R_8 = (flag_8 && first_8) || second_8;
const flag_9 = false;
const first_9 = { a: { b: [1, { c: 2 }] } };
const second_9 = [[1, [2]], { d: 3 }];
let R_9;
if (flag_9) {
  R_9 = first_9;
} else {
  R_9 = second_9;
}
const flag_10 = false;
const first_10 = { a: { b: [1, { c: 2 }] } };
const second_10 = [[1, [2]], { d: 3 }];
let R_10 = second_10;
if (flag_10) R_10 = first_10;
const flag_11 = false;
const first_11 = { a: { b: [1, { c: 2 }] } };
const second_11 = [[1, [2]], { d: 3 }];
let R_11 = second_11;
if (!flag_11) R_11 = first_11;
const flag_12 = false;
const first_12 = { a: { b: [1, { c: 2 }] } };
const second_12 = [[1, [2]], { d: 3 }];
let R_12;
if (flag_12) R_12 = first_12;
else if (!flag_12) R_12 = second_12;
else R_12 = "neither";
const flag_14 = false;
const first_14 = { a: { b: [1, { c: 2 }] } };
const second_14 = [[1, [2]], { d: 3 }];
const R_14 = (() => {
  if (flag_14) return first_14;
  return second_14;
})();
const flag_15 = false;
const first_15 = { a: { b: [1, { c: 2 }] } };
const second_15 = [[1, [2]], { d: 3 }];
let R_15;
switch (Boolean(flag_15)) {
  case true:
    R_15 = first_15;
    break;
  case false:
    R_15 = second_15;
    break;
}
const flag_16 = false;
const first_16 = { a: { b: [1, { c: 2 }] } };
const second_16 = [[1, [2]], { d: 3 }];
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
const flag_17 = false;
const first_17 = { a: { b: [1, { c: 2 }] } };
const second_17 = [[1, [2]], { d: 3 }];
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
const flag_18 = false;
const first_18 = { a: { b: [1, { c: 2 }] } };
const second_18 = [[1, [2]], { d: 3 }];
let R_18;
switch (true) {
  case !!flag_18:
    R_18 = first_18;
    break;
  default:
    R_18 = second_18;
}
const flag_19 = false;
const first_19 = { a: { b: [1, { c: 2 }] } };
const second_19 = [[1, [2]], { d: 3 }];
const R_19 = `${flag_19 ? first_19 : second_19}/path`;
const flag_20 = false;
const first_20 = { a: { b: [1, { c: 2 }] } };
const second_20 = [[1, [2]], { d: 3 }];
const R_20 = `flag=${String(flag_20)}`;
const flag_21 = false;
const first_21 = { a: { b: [1, { c: 2 }] } };
const second_21 = [[1, [2]], { d: 3 }];
const R_21 = `${flag_21 ? "a" : "b"}-${flag_21 ? "c" : "d"}`;
const flag_22 = false;
const first_22 = { a: { b: [1, { c: 2 }] } };
const second_22 = [[1, [2]], { d: 3 }];
const R_22 = "x" + String(flag_22 ? first_22 : second_22);
const flag_23 = false;
const first_23 = { a: { b: [1, { c: 2 }] } };
const second_23 = [[1, [2]], { d: 3 }];
function f_23(x_23 = flag_23 ? first_23 : second_23) {
  return x_23;
}
const R_23 = f_23();
const flag_24 = false;
const first_24 = { a: { b: [1, { c: 2 }] } };
const second_24 = [[1, [2]], { d: 3 }];
function f_24(a = flag_24, b = a ? first_24 : second_24) {
  return b;
}
const R_24 = f_24();
const flag_25 = false;
const first_25 = { a: { b: [1, { c: 2 }] } };
const second_25 = [[1, [2]], { d: 3 }];
const { x_25 = flag_25 ? first_25 : second_25 } = {};
const R_25 = x_25;
const flag_26 = false;
const first_26 = { a: { b: [1, { c: 2 }] } };
const second_26 = [[1, [2]], { d: 3 }];
const [x_26 = first_26, y_26 = second_26] = [flag_26 ? undefined : second_26];
const R_26 = [x_26, y_26];
const flag_27 = false;
const first_27 = { a: { b: [1, { c: 2 }] } };
const second_27 = [[1, [2]], { d: 3 }];
const R_27 = { ...(flag_27 ? { a: first_27 } : { b: second_27 }) };
const flag_28 = false;
const first_28 = { a: { b: [1, { c: 2 }] } };
const second_28 = [[1, [2]], { d: 3 }];
const R_28 = { base: 1, ...(flag_28 && { a: first_28 }) };
const flag_29 = false;
const first_29 = { a: { b: [1, { c: 2 }] } };
const second_29 = [[1, [2]], { d: 3 }];
const R_29 = [...(flag_29 ? [first_29] : []), second_29];
const flag_30 = false;
const first_30 = { a: { b: [1, { c: 2 }] } };
const second_30 = [[1, [2]], { d: 3 }];
const R_30 = Math.max(...(flag_30 ? [1, 2] : [3]));
const flag_31 = false;
const first_31 = { a: { b: [1, { c: 2 }] } };
const second_31 = [[1, [2]], { d: 3 }];
const R_31 = { [flag_31 ? "a" : "b"]: first_31 };
const flag_32 = false;
const first_32 = { a: { b: [1, { c: 2 }] } };
const second_32 = [[1, [2]], { d: 3 }];
class C_32 {
  static v = flag_32 ? first_32 : second_32;
}
const R_32 = C_32.v;
const flag_33 = false;
const first_33 = { a: { b: [1, { c: 2 }] } };
const second_33 = [[1, [2]], { d: 3 }];
class C_33 {
  v = flag_33 ? first_33 : second_33;
}
const R_33 = new C_33().v;
const flag_34 = false;
const first_34 = { a: { b: [1, { c: 2 }] } };
const second_34 = [[1, [2]], { d: 3 }];
const o_34 = {
  get v() {
    return flag_34 ? first_34 : second_34;
  },
};
const R_34 = o_34.v;
const flag_35 = false;
const first_35 = { a: { b: [1, { c: 2 }] } };
const second_35 = [[1, [2]], { d: 3 }];
class C_35 {
  static get v() {
    return flag_35 ? first_35 : second_35;
  }
}
const R_35 = C_35.v;
const flag_36 = false;
const first_36 = { a: { b: [1, { c: 2 }] } };
const second_36 = [[1, [2]], { d: 3 }];
class C_36 {
  static v;
  static {
    C_36.v = flag_36 ? first_36 : second_36;
  }
}
const R_36 = C_36.v;
const flag_37 = false;
const first_37 = { a: { b: [1, { c: 2 }] } };
const second_37 = [[1, [2]], { d: 3 }];
function pick_37(c, a, b) {
  return c ? a : b;
}
const R_37 = pick_37(flag_37, first_37, second_37);
const flag_38 = false;
const first_38 = { a: { b: [1, { c: 2 }] } };
const second_38 = [[1, [2]], { d: 3 }];
const pick_38 = (c) => (c ? first_38 : second_38);
const R_38 = pick_38(flag_38);
const flag_39 = false;
const first_39 = { a: { b: [1, { c: 2 }] } };
const second_39 = [[1, [2]], { d: 3 }];
function value_39() {
  return flag_39 ? first_39 : second_39;
}
const R_39 = value_39();
const flag_40 = false;
const first_40 = { a: { b: [1, { c: 2 }] } };
const second_40 = [[1, [2]], { d: 3 }];
function wrap_40(x_40) {
  return [x_40];
}
const R_40 = wrap_40(flag_40 ? first_40 : second_40);
const flag_41 = false;
const first_41 = { a: { b: [1, { c: 2 }] } };
const second_41 = [[1, [2]], { d: 3 }];
function id_41(x_41) {
  return x_41;
}
const R_41 = [id_41(flag_41 ? first_41 : second_41), id_41(first_41)];
const flag_42 = false;
const first_42 = { a: { b: [1, { c: 2 }] } };
const second_42 = [[1, [2]], { d: 3 }];
const R_42 = (function () {
  return flag_42 ? first_42 : second_42;
})();
const flag_43 = false;
const first_43 = { a: { b: [1, { c: 2 }] } };
const second_43 = [[1, [2]], { d: 3 }];
const R_43 = (() => (flag_43 ? first_43 : second_43))();
const flag_44 = false;
const first_44 = { a: { b: [1, { c: 2 }] } };
const second_44 = [[1, [2]], { d: 3 }];
const table_44 = { true: first_44, false: second_44 };
const R_44 = table_44[String(Boolean(flag_44))];
const flag_45 = false;
const first_45 = { a: { b: [1, { c: 2 }] } };
const second_45 = [[1, [2]], { d: 3 }];
const R_45 = [second_45, first_45][Number(Boolean(flag_45))];
const flag_46 = false;
const first_46 = { a: { b: [1, { c: 2 }] } };
const second_46 = [[1, [2]], { d: 3 }];
const m_46 = new Map([
  [true, first_46],
  [false, second_46],
]);
const R_46 = m_46.get(Boolean(flag_46));
const flag_47 = false;
const first_47 = { a: { b: [1, { c: 2 }] } };
const second_47 = [[1, [2]], { d: 3 }];
const o_47 = flag_47 ? { v: first_47 } : null;
const R_47 = o_47?.v ?? second_47;
const flag_48 = false;
const first_48 = { a: { b: [1, { c: 2 }] } };
const second_48 = [[1, [2]], { d: 3 }];
const R_48 = typeof (flag_48 ? first_48 : second_48);
const flag_49 = false;
const first_49 = { a: { b: [1, { c: 2 }] } };
const second_49 = [[1, [2]], { d: 3 }];
const x_49 = flag_49 ? first_49 : second_49;
const R_49 = x_49 === x_49;
const flag_50 = false;
const first_50 = { a: { b: [1, { c: 2 }] } };
const second_50 = [[1, [2]], { d: 3 }];
let R_50 = second_50;
while (flag_50) {
  R_50 = first_50;
  break;
}
const flag_51 = false;
const first_51 = { a: { b: [1, { c: 2 }] } };
const second_51 = [[1, [2]], { d: 3 }];
let R_51 = second_51;
for (let i = 0; flag_51 && i < 1; i++) R_51 = first_51;
const flag_52 = false;
const first_52 = { a: { b: [1, { c: 2 }] } };
const second_52 = [[1, [2]], { d: 3 }];
let R_52 = second_52;
do {
  if (flag_52) R_52 = first_52;
} while (false);
const flag_54 = false;
const first_54 = { a: { b: [1, { c: 2 }] } };
const second_54 = [[1, [2]], { d: 3 }];
let R_54;
try {
  R_54 = flag_54 ? first_54 : second_54;
} finally {
}
const flag_55 = false;
const first_55 = { a: { b: [1, { c: 2 }] } };
const second_55 = [[1, [2]], { d: 3 }];
let R_55;
try {
  if (!flag_55) throw second_55;
  R_55 = first_55;
} catch (e) {
  R_55 = e;
}
const flag_56 = false;
const first_56 = { a: { b: [1, { c: 2 }] } };
const second_56 = [[1, [2]], { d: 3 }];
const R_56 = (flag_56, first_56);
const flag_57 = false;
const first_57 = { a: { b: [1, { c: 2 }] } };
const second_57 = [[1, [2]], { d: 3 }];
let R_57 = flag_57;
R_57 ||= second_57;
const flag_58 = false;
const first_58 = { a: { b: [1, { c: 2 }] } };
const second_58 = [[1, [2]], { d: 3 }];
let R_58 = flag_58;
R_58 &&= first_58;
const flag_59 = false;
const first_59 = { a: { b: [1, { c: 2 }] } };
const second_59 = [[1, [2]], { d: 3 }];
let R_59 = flag_59;
R_59 ??= second_59;
const flag_60 = false;
const first_60 = { a: { b: [1, { c: 2 }] } };
const second_60 = [[1, [2]], { d: 3 }];
const c1_60 = flag_60 ? first_60 : second_60;
const c2_60 = c1_60;
const c3_60 = [c2_60];
const R_60 = c3_60[0];
const flag_61 = false;
const first_61 = { a: { b: [1, { c: 2 }] } };
const second_61 = [[1, [2]], { d: 3 }];
const R_61 = [flag_61 ? first_61 : second_61, flag_61 ? first_61 : second_61];
const flag_62 = false;
const first_62 = { a: { b: [1, { c: 2 }] } };
const second_62 = [[1, [2]], { d: 3 }];
const R_62 = [flag_62 ? first_62 : second_62, flag_62 && first_62, flag_62 || second_62, !flag_62, flag_62 ? 1 : 2, `${flag_62 ? "a" : "b"}`];
const flag_63 = false;
const first_63 = { a: { b: [1, { c: 2 }] } };
const second_63 = [[1, [2]], { d: 3 }];
const get = () => flag_63;
const R_63 = get() ? first_63 : second_63;
const flag_64 = false;
const first_64 = { a: { b: [1, { c: 2 }] } };
const second_64 = [[1, [2]], { d: 3 }];
const config_64 = { dev: flag_64, value: flag_64 ? first_64 : second_64 };
const R_64 = config_64.value;
const flag_65 = false;
const first_65 = { a: { b: [1, { c: 2 }] } };
const second_65 = [[1, [2]], { d: 3 }];
const config_65 = Object.freeze({ dev: flag_65, a: first_65, b: second_65 });
const R_65 = config_65.dev ? config_65.a : config_65.b;
const flag_66 = false;
const first_66 = { a: { b: [1, { c: 2 }] } };
const second_66 = [[1, [2]], { d: 3 }];
const config_66 = { env: { dev: flag_66 } };
const R_66 = config_66.env.dev ? first_66 : second_66;
const flag_68 = false;
const first_68 = { a: { b: [1, { c: 2 }] } };
const second_68 = [[1, [2]], { d: 3 }];
const R_68 = JSON.stringify({ v: typeof (flag_68 ? first_68 : second_68) });
const flag_69 = false;
const first_69 = { a: { b: [1, { c: 2 }] } };
const second_69 = [[1, [2]], { d: 3 }];
const R_69 = [flag_69 && first_69, second_69].filter(Boolean);
const flag_70 = false;
const first_70 = { a: { b: [1, { c: 2 }] } };
const second_70 = [[1, [2]], { d: 3 }];
const R_70 = [flag_70 ? "a" : "b", "c"].join("-");
const flag_71 = false;
const first_71 = { a: { b: [1, { c: 2 }] } };
const second_71 = [[1, [2]], { d: 3 }];
function f_71() {
  if (!flag_71) return second_71;
  return first_71;
}
const R_71 = f_71();
const flag_72 = false;
const first_72 = { a: { b: [1, { c: 2 }] } };
const second_72 = [[1, [2]], { d: 3 }];
function f_72() {
  return flag_72 ? first_72 : second_72;
  return "never";
}
const R_72 = f_72();
const flag_73 = false;
const first_73 = { a: { b: [1, { c: 2 }] } };
const second_73 = [[1, [2]], { d: 3 }];
function* g_73() {
  if (flag_73) yield first_73;
  yield second_73;
}
const R_73 = [...g_73()];
const flag_74 = false;
const first_74 = { a: { b: [1, { c: 2 }] } };
const second_74 = [[1, [2]], { d: 3 }];
class P_74 {
  constructor(v) {
    this.v = v;
  }
}
const R_74 = new P_74(flag_74 ? first_74 : second_74).v;
const flag_75 = false;
const first_75 = { a: { b: [1, { c: 2 }] } };
const second_75 = [[1, [2]], { d: 3 }];
const tag_75 = (s, v) => s[0] + String(v);
const R_75 = tag_75`v=${flag_75 ? first_75 : second_75}`;
const flag_76 = false;
const first_76 = { a: { b: [1, { c: 2 }] } };
const second_76 = [[1, [2]], { d: 3 }];
const R_76 = (flag_76 ? "a" : "b") in { a: 1 };
const flag_77 = false;
const first_77 = { a: { b: [1, { c: 2 }] } };
const second_77 = [[1, [2]], { d: 3 }];
const R_77 = (flag_77 ? [] : {}) instanceof Array;
const flag_78 = false;
const first_78 = { a: { b: [1, { c: 2 }] } };
const second_78 = [[1, [2]], { d: 3 }];
function fib_78(n) {
  return n < 2 ? n : fib_78(n - 1) + fib_78(n - 2);
}
const R_78 = fib_78(flag_78 ? 10 : 5);
const flag_79 = false;
const first_79 = { a: { b: [1, { c: 2 }] } };
const second_79 = [[1, [2]], { d: 3 }];
const R_79 = ((flag_79 ? 1 : 2) << 2) | 1;
const flag_80 = false;
const first_80 = { a: { b: [1, { c: 2 }] } };
const second_80 = [[1, [2]], { d: 3 }];
if (flag_80) {
  var hoisted_80 = first_80;
}
const R_80 = typeof hoisted_80;
const flag_81 = false;
const first_81 = { a: { b: [1, { c: 2 }] } };
const second_81 = [[1, [2]], { d: 3 }];
const Mode_81 = { Dev: 0, Prod: 1 };
const mode_81 = flag_81 ? Mode_81.Dev : Mode_81.Prod;
const R_81 = mode_81 === Mode_81.Dev ? first_81 : second_81;
const flag_82 = false;
const first_82 = { a: { b: [1, { c: 2 }] } };
const second_82 = [[1, [2]], { d: 3 }];
const R_82 = Object.entries({ a: flag_82 ? first_82 : second_82 }).length;
const flag_83 = false;
const first_83 = { a: { b: [1, { c: 2 }] } };
const second_83 = [[1, [2]], { d: 3 }];
const R_83 = (flag_83 ? "abc" : "de").length;
const flag_84 = false;
const first_84 = { a: { b: [1, { c: 2 }] } };
const second_84 = [[1, [2]], { d: 3 }];
const R_84 = String(flag_84 ? first_84 : second_84).toUpperCase();
const flag_85 = false;
const first_85 = { a: { b: [1, { c: 2 }] } };
const second_85 = [[1, [2]], { d: 3 }];
const R_85 = (flag_85 ? /a/ : /z/).test("abc");
const flag_86 = false;
const first_86 = { a: { b: [1, { c: 2 }] } };
const second_86 = [[1, [2]], { d: 3 }];
const R_86 = new Date(flag_86 ? 0 : 86400000).toISOString();
const flag_87 = false;
const first_87 = { a: { b: [1, { c: 2 }] } };
const second_87 = [[1, [2]], { d: 3 }];
const R_87 = (flag_87 ? 1.005 : 2.5).toFixed(2);
const flag_88 = false;
const first_88 = { a: { b: [1, { c: 2 }] } };
const second_88 = [[1, [2]], { d: 3 }];
let x_88 = flag_88 ? first_88 : second_88;
const R_88 = x_88;
const flag_89 = false;
const first_89 = { a: { b: [1, { c: 2 }] } };
const second_89 = [[1, [2]], { d: 3 }];
var x_89 = flag_89 ? first_89 : second_89;
var R_89 = x_89;
const flag_90 = false;
const first_90 = { a: { b: [1, { c: 2 }] } };
const second_90 = [[1, [2]], { d: 3 }];
const G_90 = !flag_90;
const R_90 = flag_90 && G_90 ? first_90 : flag_90 || G_90 ? second_90 : "neither";
const flag_91 = false;
const first_91 = { a: { b: [1, { c: 2 }] } };
const second_91 = [[1, [2]], { d: 3 }];
const G_91 = flag_91 ? true : false;
const H_91 = G_91 ? 1 : 0;
const R_91 = H_91 === 1 ? first_91 : second_91;
const flag_92 = false;
const first_92 = { a: { b: [1, { c: 2 }] } };
const second_92 = [[1, [2]], { d: 3 }];
const base_92 = flag_92 ? "http://localhost:3000" : "https://example.com";
const R_92 = new URL("/api", base_92).href;
const flag_93 = false;
const first_93 = { a: { b: [1, { c: 2 }] } };
const second_93 = [[1, [2]], { d: 3 }];
const R_93 = (flag_93 ? "Dev Mode" : "Prod Mode").toLowerCase().split(" ").join("-");
const flag_94 = false;
const first_94 = { a: { b: [1, { c: 2 }] } };
const second_94 = [[1, [2]], { d: 3 }];
const R_94 = Math.round((flag_94 ? 1.5 : 2.5) * 10) / 10;
const flag_95 = false;
const first_95 = { a: { b: [1, { c: 2 }] } };
const second_95 = [[1, [2]], { d: 3 }];
const R_95 = [{ on: flag_95, v: first_95 }, { on: !flag_95, v: second_95 }].filter((x_95) => x_95.on).map((x_95) => x_95.v);
const flag_96 = false;
const first_96 = { a: { b: [1, { c: 2 }] } };
const second_96 = [[1, [2]], { d: 3 }];
const R_96 = [flag_96 ? 1 : 2, 3, 4].reduce((a, b) => a + b, 0);
const flag_99 = false;
const first_99 = { a: { b: [1, { c: 2 }] } };
const second_99 = [[1, [2]], { d: 3 }];
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
const flag_4 = false;
const first_4 = { a: { b: [1, { c: 2 }] } };
const second_4 = [[1, [2]], { d: 3 }];
console.log(flag_4 ? first_4 : second_4);
console.log("# if-logs");
const flag_13 = false;
const first_13 = { a: { b: [1, { c: 2 }] } };
const second_13 = [[1, [2]], { d: 3 }];
if (flag_13) {
  console.log(first_13);
} else {
  console.log(second_13);
}
