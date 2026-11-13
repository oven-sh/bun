// Loops over variables of a module that are declared to be arrays of numbers and hold what JSON.parse gave: arrays of every storage, no arrays, nothing before they are initialized.
function leaf(x: any): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
function shown(value: any): string { const x: any = value; return Array.isArray(value) || ArrayBuffer.isView(value) ? `[${x.length}:${Array.from({ length: Math.min(x.length, 9) }, (_: unknown, i: number) => (i in x ? leaf(x[i]) : "hole")).join(",")}]` : leaf(x); }
function early(): number { let s = 0; for (let i = 0; i < 3; i++) { const x = later[i]!; s = (s + x) | 0; } return s; }
try { early(); console.log("early: no error"); } catch (e: any) { console.log("early:", e.constructor.name); }
const later: number[] = JSON.parse("[1,2,3]");
console.log("early", early());
let changed: number[] = JSON.parse("[1,-2,3,-4]");
function change(): any { let s: any = 0; for (let i = 0; i < 4; i++) { s += changed[i]!; if (i === 1) changed = JSON.parse("[10,\"x\",30.5,-40]"); else if (i === 2) changed = JSON.parse("[1,2,3,4.5]"); } return s; }
console.log("change", shown(change()), shown(change()), shown(changed));
const target: number[] = new Array(16).fill(0), fraction: number[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]");
function run(name: string, work: () => any): void { let answer: string; try { answer = shown(work()); } catch (e: any) { answer = e.constructor.name; } console.log(name, answer, shown(target)); }
const list0: number[] = JSON.parse("[3,-1,4,-1,5,-9,2,6]");
function sum0(): any { let s = 0; for (let i = 0; i < list0.length; i++) s += list0[i]!; return s; }
function clear0(): any { let s = 0; for (let i = 0; i < list0.length; i++) { const x = list0[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms0(): any { let s = 0; for (let i = 0; i < list0.length; i++) { const x = list0[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far0(): any { let s = 0; for (let i = 0; i < 4; i++) s += list0[i]! * fraction[i]!; return s; }
function most0(): any { let m = -1e9; for (let i = 0; i < list0.length; i++) if (list0[i]! > m) m = list0[i]!; return m; }
function own0(): any { for (let i = 0; i < list0.length; i++) list0[i] = list0[i]! + fraction[i]!; return list0; }
function back0(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list0[i]!; return s; }
const list1: number[] = JSON.parse("[1.5,-2.5,3,-4,5.5,-6,7,8]");
function sum1(): any { let s = 0; for (let i = 0; i < list1.length; i++) s += list1[i]!; return s; }
function clear1(): any { let s = 0; for (let i = 0; i < list1.length; i++) { const x = list1[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms1(): any { let s = 0; for (let i = 0; i < list1.length; i++) { const x = list1[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far1(): any { let s = 0; for (let i = 0; i < 4; i++) s += list1[i]! * fraction[i]!; return s; }
function most1(): any { let m = -1e9; for (let i = 0; i < list1.length; i++) if (list1[i]! > m) m = list1[i]!; return m; }
function own1(): any { for (let i = 0; i < list1.length; i++) list1[i] = list1[i]! + fraction[i]!; return list1; }
function back1(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list1[i]!; return s; }
const list2: number[] = JSON.parse("[]");
function sum2(): any { let s = 0; for (let i = 0; i < list2.length; i++) s += list2[i]!; return s; }
function clear2(): any { let s = 0; for (let i = 0; i < list2.length; i++) { const x = list2[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms2(): any { let s = 0; for (let i = 0; i < list2.length; i++) { const x = list2[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far2(): any { let s = 0; for (let i = 0; i < 4; i++) s += list2[i]! * fraction[i]!; return s; }
function most2(): any { let m = -1e9; for (let i = 0; i < list2.length; i++) if (list2[i]! > m) m = list2[i]!; return m; }
function own2(): any { for (let i = 0; i < list2.length; i++) list2[i] = list2[i]! + fraction[i]!; return list2; }
function back2(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list2[i]!; return s; }
const list3: number[] = JSON.parse("[1]");
function sum3(): any { let s = 0; for (let i = 0; i < list3.length; i++) s += list3[i]!; return s; }
function clear3(): any { let s = 0; for (let i = 0; i < list3.length; i++) { const x = list3[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms3(): any { let s = 0; for (let i = 0; i < list3.length; i++) { const x = list3[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far3(): any { let s = 0; for (let i = 0; i < 4; i++) s += list3[i]! * fraction[i]!; return s; }
function most3(): any { let m = -1e9; for (let i = 0; i < list3.length; i++) if (list3[i]! > m) m = list3[i]!; return m; }
function own3(): any { for (let i = 0; i < list3.length; i++) list3[i] = list3[i]! + fraction[i]!; return list3; }
function back3(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list3[i]!; return s; }
const list4: number[] = JSON.parse("[1,\"two\",-3,null,5]");
function sum4(): any { let s = 0; for (let i = 0; i < list4.length; i++) s += list4[i]!; return s; }
function clear4(): any { let s = 0; for (let i = 0; i < list4.length; i++) { const x = list4[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms4(): any { let s = 0; for (let i = 0; i < list4.length; i++) { const x = list4[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far4(): any { let s = 0; for (let i = 0; i < 4; i++) s += list4[i]! * fraction[i]!; return s; }
function most4(): any { let m = -1e9; for (let i = 0; i < list4.length; i++) if (list4[i]! > m) m = list4[i]!; return m; }
function own4(): any { for (let i = 0; i < list4.length; i++) list4[i] = list4[i]! + fraction[i]!; return list4; }
function back4(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list4[i]!; return s; }
const list5: number[] = JSON.parse("[null,null,1]");
function sum5(): any { let s = 0; for (let i = 0; i < list5.length; i++) s += list5[i]!; return s; }
function clear5(): any { let s = 0; for (let i = 0; i < list5.length; i++) { const x = list5[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms5(): any { let s = 0; for (let i = 0; i < list5.length; i++) { const x = list5[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far5(): any { let s = 0; for (let i = 0; i < 4; i++) s += list5[i]! * fraction[i]!; return s; }
function most5(): any { let m = -1e9; for (let i = 0; i < list5.length; i++) if (list5[i]! > m) m = list5[i]!; return m; }
function own5(): any { for (let i = 0; i < list5.length; i++) list5[i] = list5[i]! + fraction[i]!; return list5; }
function back5(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list5[i]!; return s; }
const list6: number[] = JSON.parse("[[1],[2],-3]");
function sum6(): any { let s = 0; for (let i = 0; i < list6.length; i++) s += list6[i]!; return s; }
function clear6(): any { let s = 0; for (let i = 0; i < list6.length; i++) { const x = list6[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms6(): any { let s = 0; for (let i = 0; i < list6.length; i++) { const x = list6[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far6(): any { let s = 0; for (let i = 0; i < 4; i++) s += list6[i]! * fraction[i]!; return s; }
function most6(): any { let m = -1e9; for (let i = 0; i < list6.length; i++) if (list6[i]! > m) m = list6[i]!; return m; }
function own6(): any { for (let i = 0; i < list6.length; i++) list6[i] = list6[i]! + fraction[i]!; return list6; }
function back6(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list6[i]!; return s; }
const list7: number[] = JSON.parse("{\"length\":3,\"0\":1,\"1\":-2,\"2\":3}");
function sum7(): any { let s = 0; for (let i = 0; i < list7.length; i++) s += list7[i]!; return s; }
function clear7(): any { let s = 0; for (let i = 0; i < list7.length; i++) { const x = list7[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms7(): any { let s = 0; for (let i = 0; i < list7.length; i++) { const x = list7[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far7(): any { let s = 0; for (let i = 0; i < 4; i++) s += list7[i]! * fraction[i]!; return s; }
function most7(): any { let m = -1e9; for (let i = 0; i < list7.length; i++) if (list7[i]! > m) m = list7[i]!; return m; }
function own7(): any { for (let i = 0; i < list7.length; i++) list7[i] = list7[i]! + fraction[i]!; return list7; }
function back7(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list7[i]!; return s; }
const list8: number[] = JSON.parse("\"text\"");
function sum8(): any { let s = 0; for (let i = 0; i < list8.length; i++) s += list8[i]!; return s; }
function clear8(): any { let s = 0; for (let i = 0; i < list8.length; i++) { const x = list8[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms8(): any { let s = 0; for (let i = 0; i < list8.length; i++) { const x = list8[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far8(): any { let s = 0; for (let i = 0; i < 4; i++) s += list8[i]! * fraction[i]!; return s; }
function most8(): any { let m = -1e9; for (let i = 0; i < list8.length; i++) if (list8[i]! > m) m = list8[i]!; return m; }
function own8(): any { for (let i = 0; i < list8.length; i++) list8[i] = list8[i]! + fraction[i]!; return list8; }
function back8(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list8[i]!; return s; }
const list9: number[] = JSON.parse("null");
function sum9(): any { let s = 0; for (let i = 0; i < list9.length; i++) s += list9[i]!; return s; }
function clear9(): any { let s = 0; for (let i = 0; i < list9.length; i++) { const x = list9[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms9(): any { let s = 0; for (let i = 0; i < list9.length; i++) { const x = list9[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far9(): any { let s = 0; for (let i = 0; i < 4; i++) s += list9[i]! * fraction[i]!; return s; }
function most9(): any { let m = -1e9; for (let i = 0; i < list9.length; i++) if (list9[i]! > m) m = list9[i]!; return m; }
function own9(): any { for (let i = 0; i < list9.length; i++) list9[i] = list9[i]! + fraction[i]!; return list9; }
function back9(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list9[i]!; return s; }
const list10: number[] = JSON.parse("[true,false,-1]");
function sum10(): any { let s = 0; for (let i = 0; i < list10.length; i++) s += list10[i]!; return s; }
function clear10(): any { let s = 0; for (let i = 0; i < list10.length; i++) { const x = list10[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms10(): any { let s = 0; for (let i = 0; i < list10.length; i++) { const x = list10[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far10(): any { let s = 0; for (let i = 0; i < 4; i++) s += list10[i]! * fraction[i]!; return s; }
function most10(): any { let m = -1e9; for (let i = 0; i < list10.length; i++) if (list10[i]! > m) m = list10[i]!; return m; }
function own10(): any { for (let i = 0; i < list10.length; i++) list10[i] = list10[i]! + fraction[i]!; return list10; }
function back10(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list10[i]!; return s; }
const list11: number[] = JSON.parse("[2147483647,2147483647,-2147483648]");
function sum11(): any { let s = 0; for (let i = 0; i < list11.length; i++) s += list11[i]!; return s; }
function clear11(): any { let s = 0; for (let i = 0; i < list11.length; i++) { const x = list11[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms11(): any { let s = 0; for (let i = 0; i < list11.length; i++) { const x = list11[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far11(): any { let s = 0; for (let i = 0; i < 4; i++) s += list11[i]! * fraction[i]!; return s; }
function most11(): any { let m = -1e9; for (let i = 0; i < list11.length; i++) if (list11[i]! > m) m = list11[i]!; return m; }
function own11(): any { for (let i = 0; i < list11.length; i++) list11[i] = list11[i]! + fraction[i]!; return list11; }
function back11(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list11[i]!; return s; }
const list12: number[] = JSON.parse("[1e300,-1e300,-0,0]");
function sum12(): any { let s = 0; for (let i = 0; i < list12.length; i++) s += list12[i]!; return s; }
function clear12(): any { let s = 0; for (let i = 0; i < list12.length; i++) { const x = list12[i]!; if (x < 0) target[i] = 0; s = (s + x) | 0; } return s; }
function arms12(): any { let s = 0; for (let i = 0; i < list12.length; i++) { const x = list12[i]!; if (x < 0) target[i] = -x; else target[i] = x + 1; s = (s + x) | 0; } return s; }
function far12(): any { let s = 0; for (let i = 0; i < 4; i++) s += list12[i]! * fraction[i]!; return s; }
function most12(): any { let m = -1e9; for (let i = 0; i < list12.length; i++) if (list12[i]! > m) m = list12[i]!; return m; }
function own12(): any { for (let i = 0; i < list12.length; i++) list12[i] = list12[i]! + fraction[i]!; return list12; }
function back12(): any { let s = 0; for (let i = 5; i >= -1; i--) s += list12[i]!; return s; }
for (let round = 0; round < 2; round++) {
  run("sum0", sum0);
  run("clear0", clear0);
  run("arms0", arms0);
  run("far0", far0);
  run("most0", most0);
  run("own0", own0);
  run("back0", back0);
  run("sum1", sum1);
  run("clear1", clear1);
  run("arms1", arms1);
  run("far1", far1);
  run("most1", most1);
  run("own1", own1);
  run("back1", back1);
  run("sum2", sum2);
  run("clear2", clear2);
  run("arms2", arms2);
  run("far2", far2);
  run("most2", most2);
  run("own2", own2);
  run("back2", back2);
  run("sum3", sum3);
  run("clear3", clear3);
  run("arms3", arms3);
  run("far3", far3);
  run("most3", most3);
  run("own3", own3);
  run("back3", back3);
  run("sum4", sum4);
  run("clear4", clear4);
  run("arms4", arms4);
  run("far4", far4);
  run("most4", most4);
  run("own4", own4);
  run("back4", back4);
  run("sum5", sum5);
  run("clear5", clear5);
  run("arms5", arms5);
  run("far5", far5);
  run("most5", most5);
  run("own5", own5);
  run("back5", back5);
  run("sum6", sum6);
  run("clear6", clear6);
  run("arms6", arms6);
  run("far6", far6);
  run("most6", most6);
  run("own6", own6);
  run("back6", back6);
  run("sum7", sum7);
  run("clear7", clear7);
  run("arms7", arms7);
  run("far7", far7);
  run("most7", most7);
  run("own7", own7);
  run("back7", back7);
  run("sum8", sum8);
  run("clear8", clear8);
  run("arms8", arms8);
  run("far8", far8);
  run("most8", most8);
  run("own8", own8);
  run("back8", back8);
  run("sum9", sum9);
  run("clear9", clear9);
  run("arms9", arms9);
  run("far9", far9);
  run("most9", most9);
  run("own9", own9);
  run("back9", back9);
  run("sum10", sum10);
  run("clear10", clear10);
  run("arms10", arms10);
  run("far10", far10);
  run("most10", most10);
  run("own10", own10);
  run("back10", back10);
  run("sum11", sum11);
  run("clear11", clear11);
  run("arms11", arms11);
  run("far11", far11);
  run("most11", most11);
  run("own11", own11);
  run("back11", back11);
  run("sum12", sum12);
  run("clear12", clear12);
  run("arms12", arms12);
  run("far12", far12);
  run("most12", most12);
  run("own12", own12);
  run("back12", back12);
}
export {};
