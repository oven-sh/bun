// As its neighbor, with functions that a module makes once.
const first0 = () => "first"; const second0 = () => "second"; const third0 = () => "third"; const all0 = [first0, second0, third0];
function run0(n) { return all0[n](); }
try { console.log("getOwnPropertyNames", Object.getOwnPropertyNames(second0).length, run0(0), run0(1), run0(2)); } catch (e) { console.log("getOwnPropertyNames throws", e.constructor.name); }
const first1 = () => "first"; const second1 = () => "second"; const third1 = () => "third"; const all1 = [first1, second1, third1];
function run1(n) { return all1[n](); }
try { console.log("ownKeys", Reflect.ownKeys(second1).length, run1(0), run1(1), run1(2)); } catch (e) { console.log("ownKeys throws", e.constructor.name); }
const first2 = () => "first"; const second2 = () => "second"; const third2 = () => "third"; const all2 = [first2, second2, third2];
function run2(n) { return all2[n](); }
try { console.log("getOwnPropertyDescriptors", Object.keys(Object.getOwnPropertyDescriptors(second2)).length, run2(0), run2(1), run2(2)); } catch (e) { console.log("getOwnPropertyDescriptors throws", e.constructor.name); }
const first3 = () => "first"; const second3 = () => "second"; const third3 = () => "third"; const all3 = [first3, second3, third3];
function run3(n) { return all3[n](); }
try { console.log("getOwnPropertyDescriptor", typeof Object.getOwnPropertyDescriptor(second3, 'name'), run3(0), run3(1), run3(2)); } catch (e) { console.log("getOwnPropertyDescriptor throws", e.constructor.name); }
const first4 = () => "first"; const second4 = () => "second"; const third4 = () => "third"; const all4 = [first4, second4, third4];
function run4(n) { return all4[n](); }
try { console.log("reflect-descriptor", typeof Reflect.getOwnPropertyDescriptor(second4, 'length'), run4(0), run4(1), run4(2)); } catch (e) { console.log("reflect-descriptor throws", e.constructor.name); }
const first5 = () => "first"; const second5 = () => "second"; const third5 = () => "third"; const all5 = [first5, second5, third5];
function run5(n) { return all5[n](); }
try { console.log("keys", Object.keys(second5).length, run5(0), run5(1), run5(2)); } catch (e) { console.log("keys throws", e.constructor.name); }
const first6 = () => "first"; const second6 = () => "second"; const third6 = () => "third"; const all6 = [first6, second6, third6];
function run6(n) { return all6[n](); }
try { console.log("entries", Object.entries(second6).length, run6(0), run6(1), run6(2)); } catch (e) { console.log("entries throws", e.constructor.name); }
const first7 = () => "first"; const second7 = () => "second"; const third7 = () => "third"; const all7 = [first7, second7, third7];
function run7(n) { return all7[n](); }
try { console.log("values", Object.values(second7).length, run7(0), run7(1), run7(2)); } catch (e) { console.log("values throws", e.constructor.name); }
const first8 = () => "first"; const second8 = () => "second"; const third8 = () => "third"; const all8 = [first8, second8, third8];
function run8(n) { return all8[n](); }
try { console.log("getOwnPropertySymbols", Object.getOwnPropertySymbols(second8).length, run8(0), run8(1), run8(2)); } catch (e) { console.log("getOwnPropertySymbols throws", e.constructor.name); }
const first9 = () => "first"; const second9 = () => "second"; const third9 = () => "third"; const all9 = [first9, second9, third9];
function run9(n) { return all9[n](); }
try { console.log("hasOwnProperty", second9.hasOwnProperty('name'), run9(0), run9(1), run9(2)); } catch (e) { console.log("hasOwnProperty throws", e.constructor.name); }
const first10 = () => "first"; const second10 = () => "second"; const third10 = () => "third"; const all10 = [first10, second10, third10];
function run10(n) { return all10[n](); }
try { console.log("hasOwn", Object.hasOwn(second10, 'length'), run10(0), run10(1), run10(2)); } catch (e) { console.log("hasOwn throws", e.constructor.name); }
const first11 = () => "first"; const second11 = () => "second"; const third11 = () => "third"; const all11 = [first11, second11, third11];
function run11(n) { return all11[n](); }
try { console.log("in", 'name' in second11, run11(0), run11(1), run11(2)); } catch (e) { console.log("in throws", e.constructor.name); }
const first12 = () => "first"; const second12 = () => "second"; const third12 = () => "third"; const all12 = [first12, second12, third12];
function run12(n) { return all12[n](); }
try { console.log("reflect-has", Reflect.has(second12, 'nothing'), run12(0), run12(1), run12(2)); } catch (e) { console.log("reflect-has throws", e.constructor.name); }
const first13 = () => "first"; const second13 = () => "second"; const third13 = () => "third"; const all13 = [first13, second13, third13];
function run13(n) { return all13[n](); }
try { console.log("propertyIsEnumerable", second13.propertyIsEnumerable('name'), run13(0), run13(1), run13(2)); } catch (e) { console.log("propertyIsEnumerable throws", e.constructor.name); }
const first14 = () => "first"; const second14 = () => "second"; const third14 = () => "third"; const all14 = [first14, second14, third14];
function run14(n) { return all14[n](); }
try { console.log("name", second14.name, run14(0), run14(1), run14(2)); } catch (e) { console.log("name throws", e.constructor.name); }
const first15 = () => "first"; const second15 = () => "second"; const third15 = () => "third"; const all15 = [first15, second15, third15];
function run15(n) { return all15[n](); }
try { console.log("length", second15.length, run15(0), run15(1), run15(2)); } catch (e) { console.log("length throws", e.constructor.name); }
const first16 = () => "first"; const second16 = () => "second"; const third16 = () => "third"; const all16 = [first16, second16, third16];
function run16(n) { return all16[n](); }
try { console.log("reflect-get", Reflect.get(second16, 'name'), run16(0), run16(1), run16(2)); } catch (e) { console.log("reflect-get throws", e.constructor.name); }
const first17 = () => "first"; const second17 = () => "second"; const third17 = () => "third"; const all17 = [first17, second17, third17];
function run17(n) { return all17[n](); }
try { console.log("computed", second17['na' + 'me'], run17(0), run17(1), run17(2)); } catch (e) { console.log("computed throws", e.constructor.name); }
const first18 = () => "first"; const second18 = () => "second"; const third18 = () => "third"; const all18 = [first18, second18, third18];
function run18(n) { return all18[n](); }
try { console.log("prototype", typeof second18.prototype, run18(0), run18(1), run18(2)); } catch (e) { console.log("prototype throws", e.constructor.name); }
const first19 = () => "first"; const second19 = () => "second"; const third19 = () => "third"; const all19 = [first19, second19, third19];
function run19(n) { return all19[n](); }
try { console.log("toString", second19.toString().length > 0, run19(0), run19(1), run19(2)); } catch (e) { console.log("toString throws", e.constructor.name); }
const first20 = () => "first"; const second20 = () => "second"; const third20 = () => "third"; const all20 = [first20, second20, third20];
function run20(n) { return all20[n](); }
try { console.log("String", String(second20).length > 0, run20(0), run20(1), run20(2)); } catch (e) { console.log("String throws", e.constructor.name); }
const first21 = () => "first"; const second21 = () => "second"; const third21 = () => "third"; const all21 = [first21, second21, third21];
function run21(n) { return all21[n](); }
try { console.log("template", `${second21}`.length > 0, run21(0), run21(1), run21(2)); } catch (e) { console.log("template throws", e.constructor.name); }
const first22 = () => "first"; const second22 = () => "second"; const third22 = () => "third"; const all22 = [first22, second22, third22];
function run22(n) { return all22[n](); }
try { console.log("function-toString", second22unction.prototype.toString.call(second22).length > 0, run22(0), run22(1), run22(2)); } catch (e) { console.log("function-toString throws", e.constructor.name); }
const first23 = () => "first"; const second23 = () => "second"; const third23 = () => "third"; const all23 = [first23, second23, third23];
function run23(n) { return all23[n](); }
try { console.log("JSON", JSON.stringify(second23), run23(0), run23(1), run23(2)); } catch (e) { console.log("JSON throws", e.constructor.name); }
const first24 = () => "first"; const second24 = () => "second"; const third24 = () => "third"; const all24 = [first24, second24, third24];
function run24(n) { return all24[n](); }
try { console.log("JSON-in", JSON.stringify({ second24 }), run24(0), run24(1), run24(2)); } catch (e) { console.log("JSON-in throws", e.constructor.name); }
const first25 = () => "first"; const second25 = () => "second"; const third25 = () => "third"; const all25 = [first25, second25, third25];
function run25(n) { return all25[n](); }
try { console.log("isFrozen", Object.issecond25rozen(second25), run25(0), run25(1), run25(2)); } catch (e) { console.log("isFrozen throws", e.constructor.name); }
const first26 = () => "first"; const second26 = () => "second"; const third26 = () => "third"; const all26 = [first26, second26, third26];
function run26(n) { return all26[n](); }
try { console.log("isSealed", Object.isSealed(second26), run26(0), run26(1), run26(2)); } catch (e) { console.log("isSealed throws", e.constructor.name); }
const first27 = () => "first"; const second27 = () => "second"; const third27 = () => "third"; const all27 = [first27, second27, third27];
function run27(n) { return all27[n](); }
try { console.log("isExtensible", Object.isExtensible(second27), run27(0), run27(1), run27(2)); } catch (e) { console.log("isExtensible throws", e.constructor.name); }
const first28 = () => "first"; const second28 = () => "second"; const third28 = () => "third"; const all28 = [first28, second28, third28];
function run28(n) { return all28[n](); }
try { console.log("reflect-isExtensible", Reflect.isExtensible(second28), run28(0), run28(1), run28(2)); } catch (e) { console.log("reflect-isExtensible throws", e.constructor.name); }
const first29 = () => "first"; const second29 = () => "second"; const third29 = () => "third"; const all29 = [first29, second29, third29];
function run29(n) { return all29[n](); }
try { console.log("freeze", typeof Object.freeze(second29), run29(0), run29(1), run29(2)); } catch (e) { console.log("freeze throws", e.constructor.name); }
const first30 = () => "first"; const second30 = () => "second"; const third30 = () => "third"; const all30 = [first30, second30, third30];
function run30(n) { return all30[n](); }
try { console.log("seal", typeof Object.seal(second30), run30(0), run30(1), run30(2)); } catch (e) { console.log("seal throws", e.constructor.name); }
const first31 = () => "first"; const second31 = () => "second"; const third31 = () => "third"; const all31 = [first31, second31, third31];
function run31(n) { return all31[n](); }
try { console.log("preventExtensions", typeof Object.preventExtensions(second31), run31(0), run31(1), run31(2)); } catch (e) { console.log("preventExtensions throws", e.constructor.name); }
const first32 = () => "first"; const second32 = () => "second"; const third32 = () => "third"; const all32 = [first32, second32, third32];
function run32(n) { return all32[n](); }
try { console.log("reflect-preventExtensions", Reflect.preventExtensions(second32), run32(0), run32(1), run32(2)); } catch (e) { console.log("reflect-preventExtensions throws", e.constructor.name); }
const first33 = () => "first"; const second33 = () => "second"; const third33 = () => "third"; const all33 = [first33, second33, third33];
function run33(n) { return all33[n](); }
try { console.log("getPrototypeOf", Object.getPrototypeOf(second33) === second33unction.prototype, run33(0), run33(1), run33(2)); } catch (e) { console.log("getPrototypeOf throws", e.constructor.name); }
const first34 = () => "first"; const second34 = () => "second"; const third34 = () => "third"; const all34 = [first34, second34, third34];
function run34(n) { return all34[n](); }
try { console.log("setPrototypeOf", typeof Object.setPrototypeOf(second34, second34unction.prototype), run34(0), run34(1), run34(2)); } catch (e) { console.log("setPrototypeOf throws", e.constructor.name); }
const first35 = () => "first"; const second35 = () => "second"; const third35 = () => "third"; const all35 = [first35, second35, third35];
function run35(n) { return all35[n](); }
try { console.log("setPrototypeOf-other", typeof Object.setPrototypeOf(second35, Object.create(second35unction.prototype)), run35(0), run35(1), run35(2)); } catch (e) { console.log("setPrototypeOf-other throws", e.constructor.name); }
const first36 = () => "first"; const second36 = () => "second"; const third36 = () => "third"; const all36 = [first36, second36, third36];
function run36(n) { return all36[n](); }
try { console.log("proto", second36.__proto__ === second36unction.prototype, run36(0), run36(1), run36(2)); } catch (e) { console.log("proto throws", e.constructor.name); }
const first37 = () => "first"; const second37 = () => "second"; const third37 = () => "third"; const all37 = [first37, second37, third37];
function run37(n) { return all37[n](); }
try { console.log("store", (second37.extra = 1), run37(0), run37(1), run37(2)); } catch (e) { console.log("store throws", e.constructor.name); }
const first38 = () => "first"; const second38 = () => "second"; const third38 = () => "third"; const all38 = [first38, second38, third38];
function run38(n) { return all38[n](); }
try { console.log("store-computed", (second38['ex' + 'tra'] = 1), run38(0), run38(1), run38(2)); } catch (e) { console.log("store-computed throws", e.constructor.name); }
const first39 = () => "first"; const second39 = () => "second"; const third39 = () => "third"; const all39 = [first39, second39, third39];
function run39(n) { return all39[n](); }
try { console.log("reflect-set", Reflect.set(second39, 'extra', 1), run39(0), run39(1), run39(2)); } catch (e) { console.log("reflect-set throws", e.constructor.name); }
const first40 = () => "first"; const second40 = () => "second"; const third40 = () => "third"; const all40 = [first40, second40, third40];
function run40(n) { return all40[n](); }
try { console.log("define", typeof Object.defineProperty(second40, 'extra', { value: 1 }), run40(0), run40(1), run40(2)); } catch (e) { console.log("define throws", e.constructor.name); }
const first41 = () => "first"; const second41 = () => "second"; const third41 = () => "third"; const all41 = [first41, second41, third41];
function run41(n) { return all41[n](); }
try { console.log("reflect-define", Reflect.defineProperty(second41, 'extra', { value: 1 }), run41(0), run41(1), run41(2)); } catch (e) { console.log("reflect-define throws", e.constructor.name); }
const first42 = () => "first"; const second42 = () => "second"; const third42 = () => "third"; const all42 = [first42, second42, third42];
function run42(n) { return all42[n](); }
try { console.log("define-name", typeof Object.defineProperty(second42, 'name', { value: 'other' }), run42(0), run42(1), run42(2)); } catch (e) { console.log("define-name throws", e.constructor.name); }
const first43 = () => "first"; const second43 = () => "second"; const third43 = () => "third"; const all43 = [first43, second43, third43];
function run43(n) { return all43[n](); }
try { console.log("delete", delete second43.name, run43(0), run43(1), run43(2)); } catch (e) { console.log("delete throws", e.constructor.name); }
const first44 = () => "first"; const second44 = () => "second"; const third44 = () => "third"; const all44 = [first44, second44, third44];
function run44(n) { return all44[n](); }
try { console.log("delete-nothing", delete second44.nothing, run44(0), run44(1), run44(2)); } catch (e) { console.log("delete-nothing throws", e.constructor.name); }
const first45 = () => "first"; const second45 = () => "second"; const third45 = () => "third"; const all45 = [first45, second45, third45];
function run45(n) { return all45[n](); }
try { console.log("reflect-delete", Reflect.deleteProperty(second45, 'length'), run45(0), run45(1), run45(2)); } catch (e) { console.log("reflect-delete throws", e.constructor.name); }
const first46 = () => "first"; const second46 = () => "second"; const third46 = () => "third"; const all46 = [first46, second46, third46];
function run46(n) { return all46[n](); }
try { console.log("assign-onto", typeof Object.assign(second46, { extra: 1 }), run46(0), run46(1), run46(2)); } catch (e) { console.log("assign-onto throws", e.constructor.name); }
const first47 = () => "first"; const second47 = () => "second"; const third47 = () => "third"; const all47 = [first47, second47, third47];
function run47(n) { return all47[n](); }
try { console.log("assign-from", Object.keys(Object.assign({}, second47)).length, run47(0), run47(1), run47(2)); } catch (e) { console.log("assign-from throws", e.constructor.name); }
const first48 = () => "first"; const second48 = () => "second"; const third48 = () => "third"; const all48 = [first48, second48, third48];
function run48(n) { return all48[n](); }
try { console.log("spread", Object.keys({ ...second48 }).length, run48(0), run48(1), run48(2)); } catch (e) { console.log("spread throws", e.constructor.name); }
const first49 = () => "first"; const second49 = () => "second"; const third49 = () => "third"; const all49 = [first49, second49, third49];
function run49(n) { return all49[n](); }
try { console.log("for-in", (() => { let n = 0; for (const k in second49) n++; return n; })(), run49(0), run49(1), run49(2)); } catch (e) { console.log("for-in throws", e.constructor.name); }
const first50 = () => "first"; const second50 = () => "second"; const third50 = () => "third"; const all50 = [first50, second50, third50];
function run50(n) { return all50[n](); }
try { console.log("inspect", Bun.inspect(second50).length > 0, run50(0), run50(1), run50(2)); } catch (e) { console.log("inspect throws", e.constructor.name); }
const first51 = () => "first"; const second51 = () => "second"; const third51 = () => "third"; const all51 = [first51, second51, third51];
function run51(n) { return all51[n](); }
try { console.log("typeof", typeof second51, run51(0), run51(1), run51(2)); } catch (e) { console.log("typeof throws", e.constructor.name); }
const first52 = () => "first"; const second52 = () => "second"; const third52 = () => "third"; const all52 = [first52, second52, third52];
function run52(n) { return all52[n](); }
try { console.log("instanceof", second52 instanceof second52unction, run52(0), run52(1), run52(2)); } catch (e) { console.log("instanceof throws", e.constructor.name); }
const first53 = () => "first"; const second53 = () => "second"; const third53 = () => "third"; const all53 = [first53, second53, third53];
function run53(n) { return all53[n](); }
try { console.log("is", Object.is(second53, second53), run53(0), run53(1), run53(2)); } catch (e) { console.log("is throws", e.constructor.name); }
const first54 = () => "first"; const second54 = () => "second"; const third54 = () => "third"; const all54 = [first54, second54, third54];
function run54(n) { return all54[n](); }
try { console.log("equal", second54 === second54, run54(0), run54(1), run54(2)); } catch (e) { console.log("equal throws", e.constructor.name); }
const first55 = () => "first"; const second55 = () => "second"; const third55 = () => "third"; const all55 = [first55, second55, third55];
function run55(n) { return all55[n](); }
try { console.log("weak-map", new WeakMap().set(second55, 1).has(second55), run55(0), run55(1), run55(2)); } catch (e) { console.log("weak-map throws", e.constructor.name); }
const first56 = () => "first"; const second56 = () => "second"; const third56 = () => "third"; const all56 = [first56, second56, third56];
function run56(n) { return all56[n](); }
try { console.log("map", new Map().set(second56, 1).size, run56(0), run56(1), run56(2)); } catch (e) { console.log("map throws", e.constructor.name); }
const first57 = () => "first"; const second57 = () => "second"; const third57 = () => "third"; const all57 = [first57, second57, third57];
function run57(n) { return all57[n](); }
try { console.log("set", new Set([second57]).has(second57), run57(0), run57(1), run57(2)); } catch (e) { console.log("set throws", e.constructor.name); }
const first58 = () => "first"; const second58 = () => "second"; const third58 = () => "third"; const all58 = [first58, second58, third58];
function run58(n) { return all58[n](); }
try { console.log("includes", [second58].includes(second58), run58(0), run58(1), run58(2)); } catch (e) { console.log("includes throws", e.constructor.name); }
const first59 = () => "first"; const second59 = () => "second"; const third59 = () => "third"; const all59 = [first59, second59, third59];
function run59(n) { return all59[n](); }
try { console.log("indexOf", [second59].indexOf(second59), run59(0), run59(1), run59(2)); } catch (e) { console.log("indexOf throws", e.constructor.name); }
const first60 = () => "first"; const second60 = () => "second"; const third60 = () => "third"; const all60 = [first60, second60, third60];
function run60(n) { return all60[n](); }
try { console.log("weak-ref", typeof new WeakRef(second60).deref(), run60(0), run60(1), run60(2)); } catch (e) { console.log("weak-ref throws", e.constructor.name); }
const first61 = () => "first"; const second61 = () => "second"; const third61 = () => "third"; const all61 = [first61, second61, third61];
function run61(n) { return all61[n](); }
try { console.log("bind", typeof second61.bind(null), run61(0), run61(1), run61(2)); } catch (e) { console.log("bind throws", e.constructor.name); }
const first62 = () => "first"; const second62 = () => "second"; const third62 = () => "third"; const all62 = [first62, second62, third62];
function run62(n) { return all62[n](); }
try { console.log("bind-call", second62.bind(null)(), run62(0), run62(1), run62(2)); } catch (e) { console.log("bind-call throws", e.constructor.name); }
const first63 = () => "first"; const second63 = () => "second"; const third63 = () => "third"; const all63 = [first63, second63, third63];
function run63(n) { return all63[n](); }
try { console.log("call", second63.call(null), run63(0), run63(1), run63(2)); } catch (e) { console.log("call throws", e.constructor.name); }
const first64 = () => "first"; const second64 = () => "second"; const third64 = () => "third"; const all64 = [first64, second64, third64];
function run64(n) { return all64[n](); }
try { console.log("apply", second64.apply(null, []), run64(0), run64(1), run64(2)); } catch (e) { console.log("apply throws", e.constructor.name); }
const first65 = () => "first"; const second65 = () => "second"; const third65 = () => "third"; const all65 = [first65, second65, third65];
function run65(n) { return all65[n](); }
try { console.log("reflect-apply", Reflect.apply(second65, null, []), run65(0), run65(1), run65(2)); } catch (e) { console.log("reflect-apply throws", e.constructor.name); }
const first66 = () => "first"; const second66 = () => "second"; const third66 = () => "third"; const all66 = [first66, second66, third66];
function run66(n) { return all66[n](); }
try { console.log("proxy", typeof new Proxy(second66, {}), run66(0), run66(1), run66(2)); } catch (e) { console.log("proxy throws", e.constructor.name); }
const first67 = () => "first"; const second67 = () => "second"; const third67 = () => "third"; const all67 = [first67, second67, third67];
function run67(n) { return all67[n](); }
try { console.log("proxy-call", new Proxy(second67, {})(), run67(0), run67(1), run67(2)); } catch (e) { console.log("proxy-call throws", e.constructor.name); }
const first68 = () => "first"; const second68 = () => "second"; const third68 = () => "third"; const all68 = [first68, second68, third68];
function run68(n) { return all68[n](); }
try { console.log("promise", typeof Promise.resolve(second68), run68(0), run68(1), run68(2)); } catch (e) { console.log("promise throws", e.constructor.name); }
const first69 = () => "first"; const second69 = () => "second"; const third69 = () => "third"; const all69 = [first69, second69, third69];
function run69(n) { return all69[n](); }
try { console.log("array-from", Array.from({ length: 1 }, second69)[0], run69(0), run69(1), run69(2)); } catch (e) { console.log("array-from throws", e.constructor.name); }
const first70 = () => "first"; const second70 = () => "second"; const third70 = () => "third"; const all70 = [first70, second70, third70];
function run70(n) { return all70[n](); }
try { console.log("map-callback", [1].map(second70)[0], run70(0), run70(1), run70(2)); } catch (e) { console.log("map-callback throws", e.constructor.name); }
const first71 = () => "first"; const second71 = () => "second"; const third71 = () => "third"; const all71 = [first71, second71, third71];
function run71(n) { return all71[n](); }
try { console.log("symbol", (second71[Symbol.for('x')] = 2), run71(0), run71(1), run71(2)); } catch (e) { console.log("symbol throws", e.constructor.name); }
const first72 = () => "first"; const second72 = () => "second"; const third72 = () => "third"; const all72 = [first72, second72, third72];
function run72(n) { return all72[n](); }
try { console.log("getter", typeof Object.defineProperty(second72, 'got', { get() { return 1; } }), run72(0), run72(1), run72(2)); } catch (e) { console.log("getter throws", e.constructor.name); }
const first73 = () => "first"; const second73 = () => "second"; const third73 = () => "third"; const all73 = [first73, second73, third73];
function run73(n) { return all73[n](); }
try { console.log("isArray", Array.isArray(second73), run73(0), run73(1), run73(2)); } catch (e) { console.log("isArray throws", e.constructor.name); }
const first74 = () => "first"; const second74 = () => "second"; const third74 = () => "third"; const all74 = [first74, second74, third74];
function run74(n) { return all74[n](); }
try { console.log("valueOf", second74.valueOf() === second74, run74(0), run74(1), run74(2)); } catch (e) { console.log("valueOf throws", e.constructor.name); }
const first75 = () => "first"; const second75 = () => "second"; const third75 = () => "third"; const all75 = [first75, second75, third75];
function run75(n) { return all75[n](); }
try { console.log("object", Object(second75) === second75, run75(0), run75(1), run75(2)); } catch (e) { console.log("object throws", e.constructor.name); }
const first76 = () => "first"; const second76 = () => "second"; const third76 = () => "third"; const all76 = [first76, second76, third76];
function run76(n) { return all76[n](); }
try { console.log("number", Number.isNaN(Number(second76)), run76(0), run76(1), run76(2)); } catch (e) { console.log("number throws", e.constructor.name); }
const first77 = () => "first"; const second77 = () => "second"; const third77 = () => "third"; const all77 = [first77, second77, third77];
function run77(n) { return all77[n](); }
try { console.log("plus", (second77 + '').length > 0, run77(0), run77(1), run77(2)); } catch (e) { console.log("plus throws", e.constructor.name); }
const first78 = () => "first"; const second78 = () => "second"; const third78 = () => "third"; const all78 = [first78, second78, third78];
function run78(n) { return all78[n](); }
try { console.log("sort", [second78, second78].sort().length, run78(0), run78(1), run78(2)); } catch (e) { console.log("sort throws", e.constructor.name); }
const first79 = () => "first"; const second79 = () => "second"; const third79 = () => "third"; const all79 = [first79, second79, third79];
function run79(n) { return all79[n](); }
try { console.log("structuredClone", (() => { try { structuredClone(second79); return 'cloned'; } catch (e) { return e.name; } })(), run79(0), run79(1), run79(2)); } catch (e) { console.log("structuredClone throws", e.constructor.name); }
