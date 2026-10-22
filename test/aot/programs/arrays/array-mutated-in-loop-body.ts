// Every loop x every change, the change in the text of the loop itself, so that no call hides it from the back end: arrays of four kinds, and typed arrays over buffers that are resized or detached.
function fresh(kind: number): number[] {
  if (kind === 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (kind === 1) return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
  if (kind === 2) { const list: number[] = []; for (let i = 0; i < 10; i++) list.push(i * 3); return list; }
  const list = new Array<number>(10); for (let i = 0; i < 10; i += 2) list[i] = i; return list;
}
function show(value: number[]): string { return value.length > 24 ? "[" + value.length + ": " + value.slice(0, 12).map(String).join(",") + "]" : "[" + Array.from(value, String).join(",") + "]"; }
const cells: [string, (list: number[]) => unknown][] = [];
function f0(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i];  } return sum + '|' + list.length; }
cells.push(['to length | nothing', f0]);
function f1(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) list.length = 0; } return sum + '|' + list.length; }
cells.push(['to length | length = 0', f1]);
function f2(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) list.length = 2; } return sum + '|' + list.length; }
cells.push(['to length | length = 2', f2]);
function f3(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; list.pop(); } return sum + '|' + list.length; }
cells.push(['to length | pop', f3]);
function f4(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) { list.pop(); list.pop(); list.pop(); } } return sum + '|' + list.length; }
cells.push(['to length | pop at 3', f4]);
function f5(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 2) list.shift(); } return sum + '|' + list.length; }
cells.push(['to length | shift', f5]);
function f6(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 2) list.splice(3); } return sum + '|' + list.length; }
cells.push(['to length | splice', f6]);
function f7(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i < 40) list.push(i + 100); } return sum + '|' + list.length; }
cells.push(['to length | push', f7]);
function f8(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 2) for (let k = 0; k < 200; k++) list.push(k); } return sum + '|' + list.length; }
cells.push(['to length | push many', f8]);
function f9(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; delete list[i + 1]; } return sum + '|' + list.length; }
cells.push(['to length | delete', f9]);
function f10(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i < 40) list[i + 1] = 0.5; } return sum + '|' + list.length; }
cells.push(['to length | a fraction', f10]);
function f11(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i < 9) list[i + 1] = NaN; } return sum + '|' + list.length; }
cells.push(['to length | NaN', f11]);
function f12(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 1) list[5000] = 7; } return sum + '|' + list.length; }
cells.push(['to length | far', f12]);
function f13(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 1) list[200000] = 7; } return sum + '|' + list.length; }
cells.push(['to length | very far', f13]);
function f14(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) { list.length = 1; list.length = 12; } } return sum + '|' + list.length; }
cells.push(['to length | shorter, longer', f14]);
function f15(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) list = [7, 8]; } return sum + '|' + list.length; }
cells.push(['to length | another array', f15]);
function f16(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; } return sum + '|' + list.length; }
cells.push(['to length | another kind', f16]);
function f17(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; if (i === 3) Object.freeze(list); } return sum + '|' + list.length; }
cells.push(['to length | frozen', f17]);
function f18(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) {  sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | nothing', f18]);
function f19(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) list.length = 0; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | length = 0', f19]);
function f20(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) list.length = 2; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | length = 2', f20]);
function f21(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { list.pop(); sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | pop', f21]);
function f22(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) { list.pop(); list.pop(); list.pop(); } sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | pop at 3', f22]);
function f23(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 2) list.shift(); sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | shift', f23]);
function f24(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 2) list.splice(3); sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | splice', f24]);
function f25(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i < 40) list.push(i + 100); sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | push', f25]);
function f26(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 2) for (let k = 0; k < 200; k++) list.push(k); sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | push many', f26]);
function f27(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { delete list[i + 1]; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | delete', f27]);
function f28(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i < 40) list[i + 1] = 0.5; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | a fraction', f28]);
function f29(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i < 9) list[i + 1] = NaN; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | NaN', f29]);
function f30(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 1) list[5000] = 7; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | far', f30]);
function f31(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 1) list[200000] = 7; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | very far', f31]);
function f32(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) { list.length = 1; list.length = 12; } sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | shorter, longer', f32]);
function f33(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) list = [7, 8]; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | another array', f33]);
function f34(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | another kind', f34]);
function f35(list: number[]): unknown { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { if (i === 3) Object.freeze(list); sum += list[i]; } return sum + '|' + list.length; }
cells.push(['change first | frozen', f35]);
function f36(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) {  sum += list[i] + ';'; } return sum; }
cells.push(['kept length | nothing', f36]);
function f37(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) list.length = 0; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | length = 0', f37]);
function f38(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) list.length = 2; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | length = 2', f38]);
function f39(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { list.pop(); sum += list[i] + ';'; } return sum; }
cells.push(['kept length | pop', f39]);
function f40(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) { list.pop(); list.pop(); list.pop(); } sum += list[i] + ';'; } return sum; }
cells.push(['kept length | pop at 3', f40]);
function f41(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 2) list.shift(); sum += list[i] + ';'; } return sum; }
cells.push(['kept length | shift', f41]);
function f42(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 2) list.splice(3); sum += list[i] + ';'; } return sum; }
cells.push(['kept length | splice', f42]);
function f43(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i < 40) list.push(i + 100); sum += list[i] + ';'; } return sum; }
cells.push(['kept length | push', f43]);
function f44(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 2) for (let k = 0; k < 200; k++) list.push(k); sum += list[i] + ';'; } return sum; }
cells.push(['kept length | push many', f44]);
function f45(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { delete list[i + 1]; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | delete', f45]);
function f46(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i < 40) list[i + 1] = 0.5; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | a fraction', f46]);
function f47(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i < 9) list[i + 1] = NaN; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | NaN', f47]);
function f48(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 1) list[5000] = 7; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | far', f48]);
function f49(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 1) list[200000] = 7; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | very far', f49]);
function f50(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) { list.length = 1; list.length = 12; } sum += list[i] + ';'; } return sum; }
cells.push(['kept length | shorter, longer', f50]);
function f51(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) list = [7, 8]; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | another array', f51]);
function f52(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; sum += list[i] + ';'; } return sum; }
cells.push(['kept length | another kind', f52]);
function f53(list: number[]): unknown { let sum = ''; const n = list.length; for (let i = 0; i < n; i++) { if (i === 3) Object.freeze(list); sum += list[i] + ';'; } return sum; }
cells.push(['kept length | frozen', f53]);
function f54(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) {  sum += list[i] + ';'; } return sum; }
cells.push(['down | nothing', f54]);
function f55(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) list.length = 0; sum += list[i] + ';'; } return sum; }
cells.push(['down | length = 0', f55]);
function f56(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) list.length = 2; sum += list[i] + ';'; } return sum; }
cells.push(['down | length = 2', f56]);
function f57(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { list.pop(); sum += list[i] + ';'; } return sum; }
cells.push(['down | pop', f57]);
function f58(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) { list.pop(); list.pop(); list.pop(); } sum += list[i] + ';'; } return sum; }
cells.push(['down | pop at 3', f58]);
function f59(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 2) list.shift(); sum += list[i] + ';'; } return sum; }
cells.push(['down | shift', f59]);
function f60(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 2) list.splice(3); sum += list[i] + ';'; } return sum; }
cells.push(['down | splice', f60]);
function f61(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i < 40) list.push(i + 100); sum += list[i] + ';'; } return sum; }
cells.push(['down | push', f61]);
function f62(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 2) for (let k = 0; k < 200; k++) list.push(k); sum += list[i] + ';'; } return sum; }
cells.push(['down | push many', f62]);
function f63(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { delete list[i + 1]; sum += list[i] + ';'; } return sum; }
cells.push(['down | delete', f63]);
function f64(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i < 40) list[i + 1] = 0.5; sum += list[i] + ';'; } return sum; }
cells.push(['down | a fraction', f64]);
function f65(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i < 9) list[i + 1] = NaN; sum += list[i] + ';'; } return sum; }
cells.push(['down | NaN', f65]);
function f66(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 1) list[5000] = 7; sum += list[i] + ';'; } return sum; }
cells.push(['down | far', f66]);
function f67(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 1) list[200000] = 7; sum += list[i] + ';'; } return sum; }
cells.push(['down | very far', f67]);
function f68(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) { list.length = 1; list.length = 12; } sum += list[i] + ';'; } return sum; }
cells.push(['down | shorter, longer', f68]);
function f69(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) list = [7, 8]; sum += list[i] + ';'; } return sum; }
cells.push(['down | another array', f69]);
function f70(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; sum += list[i] + ';'; } return sum; }
cells.push(['down | another kind', f70]);
function f71(list: number[]): unknown { let sum = ''; for (let i = list.length - 1; i >= 0; i--) { if (i === 3) Object.freeze(list); sum += list[i] + ';'; } return sum; }
cells.push(['down | frozen', f71]);
function f72(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1];  } return sum; }
cells.push(['by two | nothing', f72]);
function f73(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) list.length = 0; } return sum; }
cells.push(['by two | length = 0', f73]);
function f74(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) list.length = 2; } return sum; }
cells.push(['by two | length = 2', f74]);
function f75(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; list.pop(); } return sum; }
cells.push(['by two | pop', f75]);
function f76(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) { list.pop(); list.pop(); list.pop(); } } return sum; }
cells.push(['by two | pop at 3', f76]);
function f77(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 2) list.shift(); } return sum; }
cells.push(['by two | shift', f77]);
function f78(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 2) list.splice(3); } return sum; }
cells.push(['by two | splice', f78]);
function f79(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i < 40) list.push(i + 100); } return sum; }
cells.push(['by two | push', f79]);
function f80(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 2) for (let k = 0; k < 200; k++) list.push(k); } return sum; }
cells.push(['by two | push many', f80]);
function f81(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; delete list[i + 1]; } return sum; }
cells.push(['by two | delete', f81]);
function f82(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i < 40) list[i + 1] = 0.5; } return sum; }
cells.push(['by two | a fraction', f82]);
function f83(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i < 9) list[i + 1] = NaN; } return sum; }
cells.push(['by two | NaN', f83]);
function f84(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 1) list[5000] = 7; } return sum; }
cells.push(['by two | far', f84]);
function f85(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 1) list[200000] = 7; } return sum; }
cells.push(['by two | very far', f85]);
function f86(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) { list.length = 1; list.length = 12; } } return sum; }
cells.push(['by two | shorter, longer', f86]);
function f87(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) list = [7, 8]; } return sum; }
cells.push(['by two | another array', f87]);
function f88(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; } return sum; }
cells.push(['by two | another kind', f88]);
function f89(list: number[]): unknown { let sum = 0; for (let i = 0; i + 1 < list.length && i < 300; i += 2) { sum += list[i] * list[i + 1]; if (i === 3) Object.freeze(list); } return sum; }
cells.push(['by two | frozen', f89]);
function f90(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x;  i++; } return sum; }
cells.push(['while | nothing', f90]);
function f91(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) list.length = 0; i++; } return sum; }
cells.push(['while | length = 0', f91]);
function f92(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) list.length = 2; i++; } return sum; }
cells.push(['while | length = 2', f92]);
function f93(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; list.pop(); i++; } return sum; }
cells.push(['while | pop', f93]);
function f94(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) { list.pop(); list.pop(); list.pop(); } i++; } return sum; }
cells.push(['while | pop at 3', f94]);
function f95(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 2) list.shift(); i++; } return sum; }
cells.push(['while | shift', f95]);
function f96(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 2) list.splice(3); i++; } return sum; }
cells.push(['while | splice', f96]);
function f97(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i < 40) list.push(i + 100); i++; } return sum; }
cells.push(['while | push', f97]);
function f98(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 2) for (let k = 0; k < 200; k++) list.push(k); i++; } return sum; }
cells.push(['while | push many', f98]);
function f99(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; delete list[i + 1]; i++; } return sum; }
cells.push(['while | delete', f99]);
function f100(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i < 40) list[i + 1] = 0.5; i++; } return sum; }
cells.push(['while | a fraction', f100]);
function f101(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i < 9) list[i + 1] = NaN; i++; } return sum; }
cells.push(['while | NaN', f101]);
function f102(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 1) list[5000] = 7; i++; } return sum; }
cells.push(['while | far', f102]);
function f103(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 1) list[200000] = 7; i++; } return sum; }
cells.push(['while | very far', f103]);
function f104(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) { list.length = 1; list.length = 12; } i++; } return sum; }
cells.push(['while | shorter, longer', f104]);
function f105(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) list = [7, 8]; i++; } return sum; }
cells.push(['while | another array', f105]);
function f106(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; i++; } return sum; }
cells.push(['while | another kind', f106]);
function f107(list: number[]): unknown { let sum = 0, i = 0; while (true) { if (i >= list.length || i > 300) break; const x = list[i]; if (x === 4) { i += 2; continue; } sum += x; if (i === 3) Object.freeze(list); i++; } return sum; }
cells.push(['while | frozen', f107]);
function f108(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) {  list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | nothing', f108]);
function f109(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) list.length = 0; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | length = 0', f109]);
function f110(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) list.length = 2; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | length = 2', f110]);
function f111(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { list.pop(); list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | pop', f111]);
function f112(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) { list.pop(); list.pop(); list.pop(); } list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | pop at 3', f112]);
function f113(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 2) list.shift(); list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | shift', f113]);
function f114(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 2) list.splice(3); list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | splice', f114]);
function f115(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i < 40) list.push(i + 100); list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | push', f115]);
function f116(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 2) for (let k = 0; k < 200; k++) list.push(k); list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | push many', f116]);
function f117(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { delete list[i + 1]; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | delete', f117]);
function f118(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i < 40) list[i + 1] = 0.5; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | a fraction', f118]);
function f119(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i < 9) list[i + 1] = NaN; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | NaN', f119]);
function f120(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 1) list[5000] = 7; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | far', f120]);
function f121(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 1) list[200000] = 7; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | very far', f121]);
function f122(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) { list.length = 1; list.length = 12; } list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | shorter, longer', f122]);
function f123(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) list = [7, 8]; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | another array', f123]);
function f124(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | another kind', f124]);
function f125(list: number[]): unknown { const n = list.length; try { for (let i = 0; i < n; i++) { if (i === 3) Object.freeze(list); list[i] = i * 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores | frozen', f125]);
function f126(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1;  } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | nothing', f126]);
function f127(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) list.length = 0; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | length = 0', f127]);
function f128(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) list.length = 2; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | length = 2', f128]);
function f129(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; list.pop(); } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | pop', f129]);
function f130(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) { list.pop(); list.pop(); list.pop(); } } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | pop at 3', f130]);
function f131(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 2) list.shift(); } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | shift', f131]);
function f132(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 2) list.splice(3); } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | splice', f132]);
function f133(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i < 40) list.push(i + 100); } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | push', f133]);
function f134(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 2) for (let k = 0; k < 200; k++) list.push(k); } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | push many', f134]);
function f135(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; delete list[i + 1]; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | delete', f135]);
function f136(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i < 40) list[i + 1] = 0.5; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | a fraction', f136]);
function f137(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i < 9) list[i + 1] = NaN; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | NaN', f137]);
function f138(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 1) list[5000] = 7; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | far', f138]);
function f139(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 1) list[200000] = 7; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | very far', f139]);
function f140(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) { list.length = 1; list.length = 12; } } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | shorter, longer', f140]);
function f141(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) list = [7, 8]; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | another array', f141]);
function f142(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | another kind', f142]);
function f143(list: number[]): unknown { try { for (let i = 0; i < list.length && i < 300; i++) { list[i] = list[i] + 1; if (i === 3) Object.freeze(list); } } catch (e) { return (e as Error).constructor.name + show(list); } return show(list); }
cells.push(['stores to length | frozen', f143]);
function f144(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) {  sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | nothing', f144]);
function f145(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) list.length = 0; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | length = 0', f145]);
function f146(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) list.length = 2; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | length = 2', f146]);
function f147(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { list.pop(); sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | pop', f147]);
function f148(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) { list.pop(); list.pop(); list.pop(); } sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | pop at 3', f148]);
function f149(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 2) list.shift(); sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | shift', f149]);
function f150(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 2) list.splice(3); sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | splice', f150]);
function f151(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i < 40) list.push(i + 100); sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | push', f151]);
function f152(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 2) for (let k = 0; k < 200; k++) list.push(k); sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | push many', f152]);
function f153(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { delete list[i + 1]; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | delete', f153]);
function f154(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i < 40) list[i + 1] = 0.5; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | a fraction', f154]);
function f155(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i < 9) list[i + 1] = NaN; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | NaN', f155]);
function f156(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 1) list[5000] = 7; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | far', f156]);
function f157(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 1) list[200000] = 7; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | very far', f157]);
function f158(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) { list.length = 1; list.length = 12; } sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | shorter, longer', f158]);
function f159(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) list = [7, 8]; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | another array', f159]);
function f160(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | another kind', f160]);
function f161(list: number[]): unknown { let sum = 0; for (let i = 1; i + 1 < list.length && i < 300; i++) { if (i === 3) Object.freeze(list); sum += list[i - 1] + list[i] + list[i + 1]; } return sum; }
cells.push(['neighbors | frozen', f161]);
function f162(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';';  if (++i > 300) break; } return sum; }
cells.push(['for of | nothing', f162]);
function f163(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) list.length = 0; if (++i > 300) break; } return sum; }
cells.push(['for of | length = 0', f163]);
function f164(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) list.length = 2; if (++i > 300) break; } return sum; }
cells.push(['for of | length = 2', f164]);
function f165(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; list.pop(); if (++i > 300) break; } return sum; }
cells.push(['for of | pop', f165]);
function f166(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) { list.pop(); list.pop(); list.pop(); } if (++i > 300) break; } return sum; }
cells.push(['for of | pop at 3', f166]);
function f167(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 2) list.shift(); if (++i > 300) break; } return sum; }
cells.push(['for of | shift', f167]);
function f168(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 2) list.splice(3); if (++i > 300) break; } return sum; }
cells.push(['for of | splice', f168]);
function f169(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i < 40) list.push(i + 100); if (++i > 300) break; } return sum; }
cells.push(['for of | push', f169]);
function f170(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 2) for (let k = 0; k < 200; k++) list.push(k); if (++i > 300) break; } return sum; }
cells.push(['for of | push many', f170]);
function f171(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; delete list[i + 1]; if (++i > 300) break; } return sum; }
cells.push(['for of | delete', f171]);
function f172(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i < 40) list[i + 1] = 0.5; if (++i > 300) break; } return sum; }
cells.push(['for of | a fraction', f172]);
function f173(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i < 9) list[i + 1] = NaN; if (++i > 300) break; } return sum; }
cells.push(['for of | NaN', f173]);
function f174(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 1) list[5000] = 7; if (++i > 300) break; } return sum; }
cells.push(['for of | far', f174]);
function f175(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 1) list[200000] = 7; if (++i > 300) break; } return sum; }
cells.push(['for of | very far', f175]);
function f176(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) { list.length = 1; list.length = 12; } if (++i > 300) break; } return sum; }
cells.push(['for of | shorter, longer', f176]);
function f177(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) list = [7, 8]; if (++i > 300) break; } return sum; }
cells.push(['for of | another array', f177]);
function f178(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; if (++i > 300) break; } return sum; }
cells.push(['for of | another kind', f178]);
function f179(list: number[]): unknown { let sum = '', i = 0; for (const x of list) { sum += x + ';'; if (i === 3) Object.freeze(list); if (++i > 300) break; } return sum; }
cells.push(['for of | frozen', f179]);
function f180(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) {  sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | nothing', f180]);
function f181(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) list.length = 0; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | length = 0', f181]);
function f182(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) list.length = 2; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | length = 2', f182]);
function f183(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { list.pop(); sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | pop', f183]);
function f184(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) { list.pop(); list.pop(); list.pop(); } sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | pop at 3', f184]);
function f185(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 2) list.shift(); sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | shift', f185]);
function f186(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 2) list.splice(3); sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | splice', f186]);
function f187(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i < 40) list.push(i + 100); sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | push', f187]);
function f188(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 2) for (let k = 0; k < 200; k++) list.push(k); sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | push many', f188]);
function f189(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { delete list[i + 1]; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | delete', f189]);
function f190(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i < 40) list[i + 1] = 0.5; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | a fraction', f190]);
function f191(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i < 9) list[i + 1] = NaN; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | NaN', f191]);
function f192(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 1) list[5000] = 7; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | far', f192]);
function f193(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 1) list[200000] = 7; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | very far', f193]);
function f194(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) { list.length = 1; list.length = 12; } sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | shorter, longer', f194]);
function f195(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) list = [7, 8]; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | another array', f195]);
function f196(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) list = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75]; sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | another kind', f196]);
function f197(list: number[]): unknown { const other = list.slice(); let sum = 0; for (let i = 0; i < other.length; i++) { if (i === 3) Object.freeze(list); sum += other[i] + list[i]; } return sum; }
cells.push(['two arrays | frozen', f197]);
for (const [name, cell] of cells) {
  let line = name + ":";
  for (let turn = 0; turn < 2; turn++)
    for (let kind = 0; kind < 4; kind++) {
      try { line += " " + String(cell(fresh(kind))); } catch (e) { line += " " + (e as Error).constructor.name; }
    }
  console.log(line);
}
const typed: [string, () => unknown][] = [];
function t198(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i];  } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | nothing', t198]);
function t199(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(0); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | resize 0', t199]);
function t200(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(4 * 1); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | resize 4', t200]);
function t201(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(4 * 1 + 1); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | resize odd', t201]);
function t202(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(24 * 1); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | grow', t202]);
function t203(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | shrink, grow', t203]);
function t204(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.transfer(); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | transfer', t204]);
function t205(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.transfer(64 * 1); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | transfer longer', t205]);
function t206(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | structuredClone', t206]);
function t207(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) view = new Uint8Array(2); } return sum + '|' + view.length; }
typed.push(['Uint8Array | to length | another view', t207]);
function t208(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) {  sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | nothing', t208]);
function t209(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(0); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | resize 0', t209]);
function t210(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(4 * 1); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | resize 4', t210]);
function t211(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(4 * 1 + 1); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | resize odd', t211]);
function t212(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(24 * 1); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | grow', t212]);
function t213(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | shrink, grow', t213]);
function t214(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.transfer(); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | transfer', t214]);
function t215(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.transfer(64 * 1); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | transfer longer', t215]);
function t216(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | structuredClone', t216]);
function t217(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) view = new Uint8Array(2); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Uint8Array | change first | another view', t217]);
function t218(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) {  sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | nothing', t218]);
function t219(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(0); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | resize 0', t219]);
function t220(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 1); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | resize 4', t220]);
function t221(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 1 + 1); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | resize odd', t221]);
function t222(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(24 * 1); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | grow', t222]);
function t223(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | shrink, grow', t223]);
function t224(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | transfer', t224]);
function t225(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(64 * 1); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | transfer longer', t225]);
function t226(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | structuredClone', t226]);
function t227(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) view = new Uint8Array(2); sum += view[i] + ';'; } return sum; }
typed.push(['Uint8Array | kept length | another view', t227]);
function t228(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) {  view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | nothing', t228]);
function t229(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(0); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | resize 0', t229]);
function t230(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 1); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | resize 4', t230]);
function t231(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 1 + 1); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | resize odd', t231]);
function t232(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(24 * 1); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | grow', t232]);
function t233(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | shrink, grow', t233]);
function t234(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | transfer', t234]);
function t235(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(64 * 1); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | transfer longer', t235]);
function t236(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | structuredClone', t236]);
function t237(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) view = new Uint8Array(2); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Uint8Array | stores | another view', t237]);
function t238(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c;  i++; } return sum; }
typed.push(['Uint8Array | while | nothing', t238]);
function t239(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(0); i++; } return sum; }
typed.push(['Uint8Array | while | resize 0', t239]);
function t240(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(4 * 1); i++; } return sum; }
typed.push(['Uint8Array | while | resize 4', t240]);
function t241(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(4 * 1 + 1); i++; } return sum; }
typed.push(['Uint8Array | while | resize odd', t241]);
function t242(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(24 * 1); i++; } return sum; }
typed.push(['Uint8Array | while | grow', t242]);
function t243(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } i++; } return sum; }
typed.push(['Uint8Array | while | shrink, grow', t243]);
function t244(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.transfer(); i++; } return sum; }
typed.push(['Uint8Array | while | transfer', t244]);
function t245(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.transfer(64 * 1); i++; } return sum; }
typed.push(['Uint8Array | while | transfer longer', t245]);
function t246(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); i++; } return sum; }
typed.push(['Uint8Array | while | structuredClone', t246]);
function t247(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) view = new Uint8Array(2); i++; } return sum; }
typed.push(['Uint8Array | while | another view', t247]);
function t248(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';';  i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | nothing', t248]);
function t249(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(0); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | resize 0', t249]);
function t250(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(4 * 1); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | resize 4', t250]);
function t251(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(4 * 1 + 1); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | resize odd', t251]);
function t252(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(24 * 1); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | grow', t252]);
function t253(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | shrink, grow', t253]);
function t254(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.transfer(); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | transfer', t254]);
function t255(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.transfer(64 * 1); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | transfer longer', t255]);
function t256(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | structuredClone', t256]);
function t257(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) view = new Uint8Array(2); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | for of | another view', t257]);
function t258(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';';  }); return sum; }
typed.push(['Uint8Array | forEach | nothing', t258]);
function t259(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(0); }); return sum; }
typed.push(['Uint8Array | forEach | resize 0', t259]);
function t260(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(4 * 1); }); return sum; }
typed.push(['Uint8Array | forEach | resize 4', t260]);
function t261(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(4 * 1 + 1); }); return sum; }
typed.push(['Uint8Array | forEach | resize odd', t261]);
function t262(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(24 * 1); }); return sum; }
typed.push(['Uint8Array | forEach | grow', t262]);
function t263(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } }); return sum; }
typed.push(['Uint8Array | forEach | shrink, grow', t263]);
function t264(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.transfer(); }); return sum; }
typed.push(['Uint8Array | forEach | transfer', t264]);
function t265(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.transfer(64 * 1); }); return sum; }
typed.push(['Uint8Array | forEach | transfer longer', t265]);
function t266(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); }); return sum; }
typed.push(['Uint8Array | forEach | structuredClone', t266]);
function t267(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) view = new Uint8Array(2); }); return sum; }
typed.push(['Uint8Array | forEach | another view', t267]);
function t268(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => {  return x * 2; })).join(); }
typed.push(['Uint8Array | map | nothing', t268]);
function t269(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(0); return x * 2; })).join(); }
typed.push(['Uint8Array | map | resize 0', t269]);
function t270(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(4 * 1); return x * 2; })).join(); }
typed.push(['Uint8Array | map | resize 4', t270]);
function t271(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(4 * 1 + 1); return x * 2; })).join(); }
typed.push(['Uint8Array | map | resize odd', t271]);
function t272(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(24 * 1); return x * 2; })).join(); }
typed.push(['Uint8Array | map | grow', t272]);
function t273(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } return x * 2; })).join(); }
typed.push(['Uint8Array | map | shrink, grow', t273]);
function t274(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.transfer(); return x * 2; })).join(); }
typed.push(['Uint8Array | map | transfer', t274]);
function t275(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.transfer(64 * 1); return x * 2; })).join(); }
typed.push(['Uint8Array | map | transfer longer', t275]);
function t276(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return x * 2; })).join(); }
typed.push(['Uint8Array | map | structuredClone', t276]);
function t277(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) view = new Uint8Array(2); return x * 2; })).join(); }
typed.push(['Uint8Array | map | another view', t277]);
function t278(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++;  return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | nothing', t278]);
function t279(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(0); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | resize 0', t279]);
function t280(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(4 * 1); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | resize 4', t280]);
function t281(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(4 * 1 + 1); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | resize odd', t281]);
function t282(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(24 * 1); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | grow', t282]);
function t283(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | shrink, grow', t283]);
function t284(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.transfer(); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | transfer', t284]);
function t285(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.transfer(64 * 1); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | transfer longer', t285]);
function t286(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | structuredClone', t286]);
function t287(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) view = new Uint8Array(2); return b - a; }); return Array.from(view).join(); }
typed.push(['Uint8Array | sort | another view', t287]);
function t288(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() {  return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | nothing', t288]);
function t289(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(0); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | resize 0', t289]);
function t290(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(4 * 1); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | resize 4', t290]);
function t291(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(4 * 1 + 1); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | resize odd', t291]);
function t292(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(24 * 1); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | grow', t292]);
function t293(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | shrink, grow', t293]);
function t294(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.transfer(); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | transfer', t294]);
function t295(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.transfer(64 * 1); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | transfer longer', t295]);
function t296(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | structuredClone', t296]);
function t297(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) view = new Uint8Array(2); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | fill valueOf | another view', t297]);
function t298(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() {  return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | nothing', t298]);
function t299(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(0); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | resize 0', t299]);
function t300(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(4 * 1); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | resize 4', t300]);
function t301(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(4 * 1 + 1); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | resize odd', t301]);
function t302(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(24 * 1); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | grow', t302]);
function t303(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | shrink, grow', t303]);
function t304(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.transfer(); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | transfer', t304]);
function t305(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.transfer(64 * 1); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | transfer longer', t305]);
function t306(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | structuredClone', t306]);
function t307(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) view = new Uint8Array(2); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Uint8Array | set from array | another view', t307]);
function t308(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8);  let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | nothing', t308]);
function t309(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(0); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | resize 0', t309]);
function t310(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(4 * 1); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | resize 4', t310]);
function t311(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(4 * 1 + 1); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | resize odd', t311]);
function t312(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(24 * 1); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | grow', t312]);
function t313(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | shrink, grow', t313]);
function t314(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.transfer(); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | transfer', t314]);
function t315(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.transfer(64 * 1); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | transfer longer', t315]);
function t316(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) structuredClone(buffer, { transfer: [buffer] }); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | structuredClone', t316]);
function t317(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) view = new Uint8Array(2); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Uint8Array | subarray | another view', t317]);
function t318(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) {  sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | nothing', t318]);
function t319(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(0); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | resize 0', t319]);
function t320(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 1); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | resize 4', t320]);
function t321(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 1 + 1); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | resize odd', t321]);
function t322(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(24 * 1); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | grow', t322]);
function t323(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | shrink, grow', t323]);
function t324(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | transfer', t324]);
function t325(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(64 * 1); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | transfer longer', t325]);
function t326(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | structuredClone', t326]);
function t327(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Uint8Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) view = new Uint8Array(2); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Uint8Array | fixed length view | another view', t327]);
function t328(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) {  sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | nothing', t328]);
function t329(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(0); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | resize 0', t329]);
function t330(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 1); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | resize 4', t330]);
function t331(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 1 + 1); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | resize odd', t331]);
function t332(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(24 * 1); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | grow', t332]);
function t333(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) { buffer.resize(2 * 1); buffer.resize(16 * 1); } sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | shrink, grow', t333]);
function t334(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | transfer', t334]);
function t335(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(64 * 1); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | transfer longer', t335]);
function t336(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | structuredClone', t336]);
function t337(): unknown { const buffer = new ArrayBuffer(12 * 1, { maxByteLength: 64 * 1 }); let view = new Uint8Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) view = new Uint8Array(2); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Uint8Array | DataView | another view', t337]);
function t338(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i];  } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | nothing', t338]);
function t339(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(0); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | resize 0', t339]);
function t340(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(4 * 4); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | resize 4', t340]);
function t341(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(4 * 4 + 1); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | resize odd', t341]);
function t342(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(24 * 4); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | grow', t342]);
function t343(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | shrink, grow', t343]);
function t344(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.transfer(); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | transfer', t344]);
function t345(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.transfer(64 * 4); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | transfer longer', t345]);
function t346(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | structuredClone', t346]);
function t347(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) view = new Int32Array(2); } return sum + '|' + view.length; }
typed.push(['Int32Array | to length | another view', t347]);
function t348(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) {  sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | nothing', t348]);
function t349(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(0); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | resize 0', t349]);
function t350(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(4 * 4); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | resize 4', t350]);
function t351(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(4 * 4 + 1); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | resize odd', t351]);
function t352(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(24 * 4); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | grow', t352]);
function t353(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | shrink, grow', t353]);
function t354(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.transfer(); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | transfer', t354]);
function t355(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.transfer(64 * 4); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | transfer longer', t355]);
function t356(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | structuredClone', t356]);
function t357(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) view = new Int32Array(2); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Int32Array | change first | another view', t357]);
function t358(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) {  sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | nothing', t358]);
function t359(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(0); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | resize 0', t359]);
function t360(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 4); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | resize 4', t360]);
function t361(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 4 + 1); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | resize odd', t361]);
function t362(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(24 * 4); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | grow', t362]);
function t363(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | shrink, grow', t363]);
function t364(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | transfer', t364]);
function t365(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(64 * 4); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | transfer longer', t365]);
function t366(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | structuredClone', t366]);
function t367(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) view = new Int32Array(2); sum += view[i] + ';'; } return sum; }
typed.push(['Int32Array | kept length | another view', t367]);
function t368(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) {  view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | nothing', t368]);
function t369(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(0); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | resize 0', t369]);
function t370(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 4); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | resize 4', t370]);
function t371(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 4 + 1); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | resize odd', t371]);
function t372(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(24 * 4); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | grow', t372]);
function t373(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | shrink, grow', t373]);
function t374(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | transfer', t374]);
function t375(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(64 * 4); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | transfer longer', t375]);
function t376(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | structuredClone', t376]);
function t377(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) view = new Int32Array(2); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Int32Array | stores | another view', t377]);
function t378(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c;  i++; } return sum; }
typed.push(['Int32Array | while | nothing', t378]);
function t379(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(0); i++; } return sum; }
typed.push(['Int32Array | while | resize 0', t379]);
function t380(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(4 * 4); i++; } return sum; }
typed.push(['Int32Array | while | resize 4', t380]);
function t381(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(4 * 4 + 1); i++; } return sum; }
typed.push(['Int32Array | while | resize odd', t381]);
function t382(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(24 * 4); i++; } return sum; }
typed.push(['Int32Array | while | grow', t382]);
function t383(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } i++; } return sum; }
typed.push(['Int32Array | while | shrink, grow', t383]);
function t384(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.transfer(); i++; } return sum; }
typed.push(['Int32Array | while | transfer', t384]);
function t385(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.transfer(64 * 4); i++; } return sum; }
typed.push(['Int32Array | while | transfer longer', t385]);
function t386(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); i++; } return sum; }
typed.push(['Int32Array | while | structuredClone', t386]);
function t387(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) view = new Int32Array(2); i++; } return sum; }
typed.push(['Int32Array | while | another view', t387]);
function t388(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';';  i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | nothing', t388]);
function t389(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(0); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | resize 0', t389]);
function t390(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(4 * 4); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | resize 4', t390]);
function t391(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(4 * 4 + 1); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | resize odd', t391]);
function t392(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(24 * 4); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | grow', t392]);
function t393(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | shrink, grow', t393]);
function t394(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.transfer(); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | transfer', t394]);
function t395(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.transfer(64 * 4); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | transfer longer', t395]);
function t396(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | structuredClone', t396]);
function t397(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) view = new Int32Array(2); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | for of | another view', t397]);
function t398(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';';  }); return sum; }
typed.push(['Int32Array | forEach | nothing', t398]);
function t399(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(0); }); return sum; }
typed.push(['Int32Array | forEach | resize 0', t399]);
function t400(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(4 * 4); }); return sum; }
typed.push(['Int32Array | forEach | resize 4', t400]);
function t401(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(4 * 4 + 1); }); return sum; }
typed.push(['Int32Array | forEach | resize odd', t401]);
function t402(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(24 * 4); }); return sum; }
typed.push(['Int32Array | forEach | grow', t402]);
function t403(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } }); return sum; }
typed.push(['Int32Array | forEach | shrink, grow', t403]);
function t404(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.transfer(); }); return sum; }
typed.push(['Int32Array | forEach | transfer', t404]);
function t405(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.transfer(64 * 4); }); return sum; }
typed.push(['Int32Array | forEach | transfer longer', t405]);
function t406(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); }); return sum; }
typed.push(['Int32Array | forEach | structuredClone', t406]);
function t407(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) view = new Int32Array(2); }); return sum; }
typed.push(['Int32Array | forEach | another view', t407]);
function t408(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => {  return x * 2; })).join(); }
typed.push(['Int32Array | map | nothing', t408]);
function t409(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(0); return x * 2; })).join(); }
typed.push(['Int32Array | map | resize 0', t409]);
function t410(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(4 * 4); return x * 2; })).join(); }
typed.push(['Int32Array | map | resize 4', t410]);
function t411(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(4 * 4 + 1); return x * 2; })).join(); }
typed.push(['Int32Array | map | resize odd', t411]);
function t412(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(24 * 4); return x * 2; })).join(); }
typed.push(['Int32Array | map | grow', t412]);
function t413(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } return x * 2; })).join(); }
typed.push(['Int32Array | map | shrink, grow', t413]);
function t414(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.transfer(); return x * 2; })).join(); }
typed.push(['Int32Array | map | transfer', t414]);
function t415(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.transfer(64 * 4); return x * 2; })).join(); }
typed.push(['Int32Array | map | transfer longer', t415]);
function t416(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return x * 2; })).join(); }
typed.push(['Int32Array | map | structuredClone', t416]);
function t417(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) view = new Int32Array(2); return x * 2; })).join(); }
typed.push(['Int32Array | map | another view', t417]);
function t418(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++;  return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | nothing', t418]);
function t419(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(0); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | resize 0', t419]);
function t420(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(4 * 4); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | resize 4', t420]);
function t421(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(4 * 4 + 1); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | resize odd', t421]);
function t422(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(24 * 4); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | grow', t422]);
function t423(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | shrink, grow', t423]);
function t424(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.transfer(); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | transfer', t424]);
function t425(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.transfer(64 * 4); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | transfer longer', t425]);
function t426(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | structuredClone', t426]);
function t427(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) view = new Int32Array(2); return b - a; }); return Array.from(view).join(); }
typed.push(['Int32Array | sort | another view', t427]);
function t428(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() {  return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | nothing', t428]);
function t429(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(0); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | resize 0', t429]);
function t430(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(4 * 4); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | resize 4', t430]);
function t431(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(4 * 4 + 1); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | resize odd', t431]);
function t432(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(24 * 4); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | grow', t432]);
function t433(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | shrink, grow', t433]);
function t434(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.transfer(); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | transfer', t434]);
function t435(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.transfer(64 * 4); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | transfer longer', t435]);
function t436(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | structuredClone', t436]);
function t437(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) view = new Int32Array(2); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | fill valueOf | another view', t437]);
function t438(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() {  return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | nothing', t438]);
function t439(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(0); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | resize 0', t439]);
function t440(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(4 * 4); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | resize 4', t440]);
function t441(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(4 * 4 + 1); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | resize odd', t441]);
function t442(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(24 * 4); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | grow', t442]);
function t443(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | shrink, grow', t443]);
function t444(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.transfer(); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | transfer', t444]);
function t445(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.transfer(64 * 4); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | transfer longer', t445]);
function t446(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | structuredClone', t446]);
function t447(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) view = new Int32Array(2); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Int32Array | set from array | another view', t447]);
function t448(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8);  let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | nothing', t448]);
function t449(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(0); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | resize 0', t449]);
function t450(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(4 * 4); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | resize 4', t450]);
function t451(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(4 * 4 + 1); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | resize odd', t451]);
function t452(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(24 * 4); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | grow', t452]);
function t453(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | shrink, grow', t453]);
function t454(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.transfer(); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | transfer', t454]);
function t455(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.transfer(64 * 4); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | transfer longer', t455]);
function t456(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) structuredClone(buffer, { transfer: [buffer] }); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | structuredClone', t456]);
function t457(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) view = new Int32Array(2); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Int32Array | subarray | another view', t457]);
function t458(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) {  sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | nothing', t458]);
function t459(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(0); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | resize 0', t459]);
function t460(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 4); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | resize 4', t460]);
function t461(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 4 + 1); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | resize odd', t461]);
function t462(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(24 * 4); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | grow', t462]);
function t463(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | shrink, grow', t463]);
function t464(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | transfer', t464]);
function t465(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(64 * 4); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | transfer longer', t465]);
function t466(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | structuredClone', t466]);
function t467(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Int32Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) view = new Int32Array(2); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Int32Array | fixed length view | another view', t467]);
function t468(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) {  sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | nothing', t468]);
function t469(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(0); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | resize 0', t469]);
function t470(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 4); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | resize 4', t470]);
function t471(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 4 + 1); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | resize odd', t471]);
function t472(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(24 * 4); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | grow', t472]);
function t473(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) { buffer.resize(2 * 4); buffer.resize(16 * 4); } sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | shrink, grow', t473]);
function t474(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | transfer', t474]);
function t475(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(64 * 4); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | transfer longer', t475]);
function t476(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | structuredClone', t476]);
function t477(): unknown { const buffer = new ArrayBuffer(12 * 4, { maxByteLength: 64 * 4 }); let view = new Int32Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) view = new Int32Array(2); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Int32Array | DataView | another view', t477]);
function t478(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i];  } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | nothing', t478]);
function t479(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(0); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | resize 0', t479]);
function t480(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(4 * 8); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | resize 4', t480]);
function t481(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(4 * 8 + 1); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | resize odd', t481]);
function t482(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.resize(24 * 8); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | grow', t482]);
function t483(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | shrink, grow', t483]);
function t484(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.transfer(); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | transfer', t484]);
function t485(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) buffer.transfer(64 * 8); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | transfer longer', t485]);
function t486(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | structuredClone', t486]);
function t487(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { sum += view[i]; if (i === 3) view = new Float64Array(2); } return sum + '|' + view.length; }
typed.push(['Float64Array | to length | another view', t487]);
function t488(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) {  sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | nothing', t488]);
function t489(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(0); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | resize 0', t489]);
function t490(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(4 * 8); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | resize 4', t490]);
function t491(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(4 * 8 + 1); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | resize odd', t491]);
function t492(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.resize(24 * 8); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | grow', t492]);
function t493(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | shrink, grow', t493]);
function t494(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.transfer(); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | transfer', t494]);
function t495(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) buffer.transfer(64 * 8); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | transfer longer', t495]);
function t496(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | structuredClone', t496]);
function t497(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0; for (let i = 0; i < view.length && i < 300; i++) { if (i === 3) view = new Float64Array(2); sum += view[i]; } return sum + '|' + view.length; }
typed.push(['Float64Array | change first | another view', t497]);
function t498(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) {  sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | nothing', t498]);
function t499(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(0); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | resize 0', t499]);
function t500(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 8); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | resize 4', t500]);
function t501(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 8 + 1); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | resize odd', t501]);
function t502(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(24 * 8); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | grow', t502]);
function t503(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | shrink, grow', t503]);
function t504(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | transfer', t504]);
function t505(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(64 * 8); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | transfer longer', t505]);
function t506(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | structuredClone', t506]);
function t507(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) view = new Float64Array(2); sum += view[i] + ';'; } return sum; }
typed.push(['Float64Array | kept length | another view', t507]);
function t508(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) {  view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | nothing', t508]);
function t509(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(0); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | resize 0', t509]);
function t510(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 8); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | resize 4', t510]);
function t511(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(4 * 8 + 1); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | resize odd', t511]);
function t512(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.resize(24 * 8); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | grow', t512]);
function t513(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | shrink, grow', t513]);
function t514(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | transfer', t514]);
function t515(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) buffer.transfer(64 * 8); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | transfer longer', t515]);
function t516(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | structuredClone', t516]);
function t517(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const n = view.length; for (let i = 0; i < n; i++) { if (i === 3) view = new Float64Array(2); view[i] = i * 2; } return Array.from(view).join() + '|' + view.length; }
typed.push(['Float64Array | stores | another view', t517]);
function t518(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c;  i++; } return sum; }
typed.push(['Float64Array | while | nothing', t518]);
function t519(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(0); i++; } return sum; }
typed.push(['Float64Array | while | resize 0', t519]);
function t520(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(4 * 8); i++; } return sum; }
typed.push(['Float64Array | while | resize 4', t520]);
function t521(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(4 * 8 + 1); i++; } return sum; }
typed.push(['Float64Array | while | resize odd', t521]);
function t522(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.resize(24 * 8); i++; } return sum; }
typed.push(['Float64Array | while | grow', t522]);
function t523(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } i++; } return sum; }
typed.push(['Float64Array | while | shrink, grow', t523]);
function t524(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.transfer(); i++; } return sum; }
typed.push(['Float64Array | while | transfer', t524]);
function t525(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) buffer.transfer(64 * 8); i++; } return sum; }
typed.push(['Float64Array | while | transfer longer', t525]);
function t526(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); i++; } return sum; }
typed.push(['Float64Array | while | structuredClone', t526]);
function t527(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = 0, i = 0; while (true) { if (i >= view.length) break; const c = view[i]; if (c === 4) { i += 2; continue; } sum += c; if (i === 3) view = new Float64Array(2); i++; } return sum; }
typed.push(['Float64Array | while | another view', t527]);
function t528(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';';  i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | nothing', t528]);
function t529(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(0); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | resize 0', t529]);
function t530(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(4 * 8); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | resize 4', t530]);
function t531(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(4 * 8 + 1); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | resize odd', t531]);
function t532(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.resize(24 * 8); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | grow', t532]);
function t533(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | shrink, grow', t533]);
function t534(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.transfer(); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | transfer', t534]);
function t535(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) buffer.transfer(64 * 8); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | transfer longer', t535]);
function t536(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | structuredClone', t536]);
function t537(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = '', i = 0; try { for (const x of view) { sum += x + ';'; if (i === 3) view = new Float64Array(2); i++; } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | for of | another view', t537]);
function t538(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';';  }); return sum; }
typed.push(['Float64Array | forEach | nothing', t538]);
function t539(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(0); }); return sum; }
typed.push(['Float64Array | forEach | resize 0', t539]);
function t540(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(4 * 8); }); return sum; }
typed.push(['Float64Array | forEach | resize 4', t540]);
function t541(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(4 * 8 + 1); }); return sum; }
typed.push(['Float64Array | forEach | resize odd', t541]);
function t542(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.resize(24 * 8); }); return sum; }
typed.push(['Float64Array | forEach | grow', t542]);
function t543(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } }); return sum; }
typed.push(['Float64Array | forEach | shrink, grow', t543]);
function t544(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.transfer(); }); return sum; }
typed.push(['Float64Array | forEach | transfer', t544]);
function t545(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) buffer.transfer(64 * 8); }); return sum; }
typed.push(['Float64Array | forEach | transfer longer', t545]);
function t546(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); }); return sum; }
typed.push(['Float64Array | forEach | structuredClone', t546]);
function t547(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let sum = ''; view.forEach((x, i) => { sum += x + ';'; if (i === 3) view = new Float64Array(2); }); return sum; }
typed.push(['Float64Array | forEach | another view', t547]);
function t548(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => {  return x * 2; })).join(); }
typed.push(['Float64Array | map | nothing', t548]);
function t549(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(0); return x * 2; })).join(); }
typed.push(['Float64Array | map | resize 0', t549]);
function t550(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(4 * 8); return x * 2; })).join(); }
typed.push(['Float64Array | map | resize 4', t550]);
function t551(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(4 * 8 + 1); return x * 2; })).join(); }
typed.push(['Float64Array | map | resize odd', t551]);
function t552(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.resize(24 * 8); return x * 2; })).join(); }
typed.push(['Float64Array | map | grow', t552]);
function t553(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } return x * 2; })).join(); }
typed.push(['Float64Array | map | shrink, grow', t553]);
function t554(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.transfer(); return x * 2; })).join(); }
typed.push(['Float64Array | map | transfer', t554]);
function t555(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) buffer.transfer(64 * 8); return x * 2; })).join(); }
typed.push(['Float64Array | map | transfer longer', t555]);
function t556(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return x * 2; })).join(); }
typed.push(['Float64Array | map | structuredClone', t556]);
function t557(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; return Array.from(view.map((x, i) => { if (i === 3) view = new Float64Array(2); return x * 2; })).join(); }
typed.push(['Float64Array | map | another view', t557]);
function t558(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++;  return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | nothing', t558]);
function t559(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(0); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | resize 0', t559]);
function t560(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(4 * 8); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | resize 4', t560]);
function t561(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(4 * 8 + 1); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | resize odd', t561]);
function t562(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.resize(24 * 8); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | grow', t562]);
function t563(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | shrink, grow', t563]);
function t564(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.transfer(); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | transfer', t564]);
function t565(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) buffer.transfer(64 * 8); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | transfer longer', t565]);
function t566(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | structuredClone', t566]);
function t567(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 0; view.sort((a, b) => { i++; if (i === 3) view = new Float64Array(2); return b - a; }); return Array.from(view).join(); }
typed.push(['Float64Array | sort | another view', t567]);
function t568(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() {  return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | nothing', t568]);
function t569(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(0); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | resize 0', t569]);
function t570(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(4 * 8); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | resize 4', t570]);
function t571(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(4 * 8 + 1); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | resize odd', t571]);
function t572(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.resize(24 * 8); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | grow', t572]);
function t573(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | shrink, grow', t573]);
function t574(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.transfer(); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | transfer', t574]);
function t575(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) buffer.transfer(64 * 8); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | transfer longer', t575]);
function t576(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | structuredClone', t576]);
function t577(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.fill(1, 0, { valueOf() { if (i === 3) view = new Float64Array(2); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | fill valueOf | another view', t577]);
function t578(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() {  return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | nothing', t578]);
function t579(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(0); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | resize 0', t579]);
function t580(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(4 * 8); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | resize 4', t580]);
function t581(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(4 * 8 + 1); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | resize odd', t581]);
function t582(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.resize(24 * 8); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | grow', t582]);
function t583(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | shrink, grow', t583]);
function t584(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.transfer(); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | transfer', t584]);
function t585(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) buffer.transfer(64 * 8); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | transfer longer', t585]);
function t586(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | structuredClone', t586]);
function t587(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; try { view.set([{ valueOf() { if (i === 3) view = new Float64Array(2); return 5; } } as any, 6, 7, 8, 9]); } catch (e) { return (e as Error).constructor.name; } return Array.from(view).join(); }
typed.push(['Float64Array | set from array | another view', t587]);
function t588(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8);  let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | nothing', t588]);
function t589(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(0); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | resize 0', t589]);
function t590(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(4 * 8); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | resize 4', t590]);
function t591(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(4 * 8 + 1); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | resize odd', t591]);
function t592(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.resize(24 * 8); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | grow', t592]);
function t593(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | shrink, grow', t593]);
function t594(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.transfer(); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | transfer', t594]);
function t595(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) buffer.transfer(64 * 8); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | transfer longer', t595]);
function t596(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) structuredClone(buffer, { transfer: [buffer] }); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | structuredClone', t596]);
function t597(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; let i = 3; const part = view.subarray(2, 8); if (i === 3) view = new Float64Array(2); let sum = ''; for (let k = 0; k < part.length; k++) sum += part[k] + ';'; return sum + part.length; }
typed.push(['Float64Array | subarray | another view', t597]);
function t598(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) {  sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | nothing', t598]);
function t599(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(0); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | resize 0', t599]);
function t600(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 8); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | resize 4', t600]);
function t601(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 8 + 1); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | resize odd', t601]);
function t602(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(24 * 8); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | grow', t602]);
function t603(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | shrink, grow', t603]);
function t604(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | transfer', t604]);
function t605(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(64 * 8); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | transfer longer', t605]);
function t606(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | structuredClone', t606]);
function t607(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const fixed = new Float64Array(buffer, 0, 8); let sum = ''; for (let i = 0; i < 8; i++) { if (i === 3) view = new Float64Array(2); sum += fixed[i] + ';'; fixed[i] = 1; } return sum + fixed.length; }
typed.push(['Float64Array | fixed length view | another view', t607]);
function t608(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) {  sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | nothing', t608]);
function t609(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(0); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | resize 0', t609]);
function t610(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 8); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | resize 4', t610]);
function t611(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(4 * 8 + 1); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | resize odd', t611]);
function t612(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.resize(24 * 8); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | grow', t612]);
function t613(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) { buffer.resize(2 * 8); buffer.resize(16 * 8); } sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | shrink, grow', t613]);
function t614(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | transfer', t614]);
function t615(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) buffer.transfer(64 * 8); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | transfer longer', t615]);
function t616(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) structuredClone(buffer, { transfer: [buffer] }); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | structuredClone', t616]);
function t617(): unknown { const buffer = new ArrayBuffer(12 * 8, { maxByteLength: 64 * 8 }); let view = new Float64Array(buffer); for (let k = 0; k < view.length; k++) view[k] = k + 1; const data = new DataView(buffer); let sum = ''; try { for (let i = 0; i < 8; i++) { if (i === 3) view = new Float64Array(2); sum += data.getUint8(i) + ';'; data.setUint8(i, 9); } } catch (e) { sum += (e as Error).constructor.name; } return sum; }
typed.push(['Float64Array | DataView | another view', t617]);
for (const [name, cell] of typed) {
  let line = name + ":";
  for (let turn = 0; turn < 2; turn++) {
    try { line += " " + String(cell()); } catch (e) { line += " " + (e as Error).constructor.name; }
  }
  console.log(line);
}
