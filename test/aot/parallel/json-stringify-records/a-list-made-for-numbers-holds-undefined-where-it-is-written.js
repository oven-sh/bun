function scene1(turn) {
  const copy = Array.of(undefined, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often1() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene1(turn);
  return last;
}
console.log("Array.of, undefined, at the top, read:", often1());
function scene2(turn) {
  const copy = Array.of(undefined, 2);
  return [0, JSON.stringify(copy)];
}
function often2() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene2(turn);
  return last;
}
console.log("Array.of, undefined, at the top, not read:", often2());
function scene3(turn) {
  const copy = Array.of(undefined, 2);
  return [copy[1], JSON.stringify([copy])];
}
function often3() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene3(turn);
  return last;
}
console.log("Array.of, undefined, in a list, read:", often3());
function scene4(turn) {
  const copy = Array.of(undefined, 2);
  return [0, JSON.stringify([copy])];
}
function often4() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene4(turn);
  return last;
}
console.log("Array.of, undefined, in a list, not read:", often4());
function scene5(turn) {
  const copy = Array.of(undefined, 2);
  return [copy[1], JSON.stringify({ copy })];
}
function often5() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene5(turn);
  return last;
}
console.log("Array.of, undefined, in an object, read:", often5());
function scene6(turn) {
  const copy = Array.of(undefined, 2);
  return [0, JSON.stringify({ copy })];
}
function often6() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene6(turn);
  return last;
}
console.log("Array.of, undefined, in an object, not read:", often6());
function scene7(turn) {
  const copy = Array.of(null, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often7() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene7(turn);
  return last;
}
console.log("Array.of, null, at the top, read:", often7());
function scene8(turn) {
  const copy = Array.of(null, 2);
  return [0, JSON.stringify(copy)];
}
function often8() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene8(turn);
  return last;
}
console.log("Array.of, null, at the top, not read:", often8());
function scene9(turn) {
  const copy = Array.of(null, 2);
  return [copy[1], JSON.stringify([copy])];
}
function often9() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene9(turn);
  return last;
}
console.log("Array.of, null, in a list, read:", often9());
function scene10(turn) {
  const copy = Array.of(null, 2);
  return [0, JSON.stringify([copy])];
}
function often10() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene10(turn);
  return last;
}
console.log("Array.of, null, in a list, not read:", often10());
function scene11(turn) {
  const copy = Array.of(null, 2);
  return [copy[1], JSON.stringify({ copy })];
}
function often11() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene11(turn);
  return last;
}
console.log("Array.of, null, in an object, read:", often11());
function scene12(turn) {
  const copy = Array.of(null, 2);
  return [0, JSON.stringify({ copy })];
}
function often12() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene12(turn);
  return last;
}
console.log("Array.of, null, in an object, not read:", often12());
function scene13(turn) {
  const copy = Array.of(() => 1, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often13() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene13(turn);
  return last;
}
console.log("Array.of, a function, at the top, read:", often13());
function scene14(turn) {
  const copy = Array.of(() => 1, 2);
  return [0, JSON.stringify(copy)];
}
function often14() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene14(turn);
  return last;
}
console.log("Array.of, a function, at the top, not read:", often14());
function scene15(turn) {
  const copy = Array.of(() => 1, 2);
  return [copy[1], JSON.stringify([copy])];
}
function often15() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene15(turn);
  return last;
}
console.log("Array.of, a function, in a list, read:", often15());
function scene16(turn) {
  const copy = Array.of(() => 1, 2);
  return [0, JSON.stringify([copy])];
}
function often16() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene16(turn);
  return last;
}
console.log("Array.of, a function, in a list, not read:", often16());
function scene17(turn) {
  const copy = Array.of(() => 1, 2);
  return [copy[1], JSON.stringify({ copy })];
}
function often17() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene17(turn);
  return last;
}
console.log("Array.of, a function, in an object, read:", often17());
function scene18(turn) {
  const copy = Array.of(() => 1, 2);
  return [0, JSON.stringify({ copy })];
}
function often18() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene18(turn);
  return last;
}
console.log("Array.of, a function, in an object, not read:", often18());
function scene19(turn) {
  const copy = Array.of(Symbol.iterator, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often19() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene19(turn);
  return last;
}
console.log("Array.of, a symbol, at the top, read:", often19());
function scene20(turn) {
  const copy = Array.of(Symbol.iterator, 2);
  return [0, JSON.stringify(copy)];
}
function often20() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene20(turn);
  return last;
}
console.log("Array.of, a symbol, at the top, not read:", often20());
function scene21(turn) {
  const copy = Array.of(Symbol.iterator, 2);
  return [copy[1], JSON.stringify([copy])];
}
function often21() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene21(turn);
  return last;
}
console.log("Array.of, a symbol, in a list, read:", often21());
function scene22(turn) {
  const copy = Array.of(Symbol.iterator, 2);
  return [0, JSON.stringify([copy])];
}
function often22() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene22(turn);
  return last;
}
console.log("Array.of, a symbol, in a list, not read:", often22());
function scene23(turn) {
  const copy = Array.of(Symbol.iterator, 2);
  return [copy[1], JSON.stringify({ copy })];
}
function often23() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene23(turn);
  return last;
}
console.log("Array.of, a symbol, in an object, read:", often23());
function scene24(turn) {
  const copy = Array.of(Symbol.iterator, 2);
  return [0, JSON.stringify({ copy })];
}
function often24() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene24(turn);
  return last;
}
console.log("Array.of, a symbol, in an object, not read:", often24());
function scene25(turn) {
  const copy = Array.from([undefined, 2]);
  return [copy[1], JSON.stringify(copy)];
}
function often25() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene25(turn);
  return last;
}
console.log("Array.from, undefined, at the top, read:", often25());
function scene26(turn) {
  const copy = Array.from([undefined, 2]);
  return [0, JSON.stringify(copy)];
}
function often26() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene26(turn);
  return last;
}
console.log("Array.from, undefined, at the top, not read:", often26());
function scene27(turn) {
  const copy = Array.from([undefined, 2]);
  return [copy[1], JSON.stringify([copy])];
}
function often27() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene27(turn);
  return last;
}
console.log("Array.from, undefined, in a list, read:", often27());
function scene28(turn) {
  const copy = Array.from([undefined, 2]);
  return [0, JSON.stringify([copy])];
}
function often28() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene28(turn);
  return last;
}
console.log("Array.from, undefined, in a list, not read:", often28());
function scene29(turn) {
  const copy = Array.from([undefined, 2]);
  return [copy[1], JSON.stringify({ copy })];
}
function often29() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene29(turn);
  return last;
}
console.log("Array.from, undefined, in an object, read:", often29());
function scene30(turn) {
  const copy = Array.from([undefined, 2]);
  return [0, JSON.stringify({ copy })];
}
function often30() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene30(turn);
  return last;
}
console.log("Array.from, undefined, in an object, not read:", often30());
function scene31(turn) {
  const copy = Array.from([null, 2]);
  return [copy[1], JSON.stringify(copy)];
}
function often31() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene31(turn);
  return last;
}
console.log("Array.from, null, at the top, read:", often31());
function scene32(turn) {
  const copy = Array.from([null, 2]);
  return [0, JSON.stringify(copy)];
}
function often32() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene32(turn);
  return last;
}
console.log("Array.from, null, at the top, not read:", often32());
function scene33(turn) {
  const copy = Array.from([null, 2]);
  return [copy[1], JSON.stringify([copy])];
}
function often33() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene33(turn);
  return last;
}
console.log("Array.from, null, in a list, read:", often33());
function scene34(turn) {
  const copy = Array.from([null, 2]);
  return [0, JSON.stringify([copy])];
}
function often34() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene34(turn);
  return last;
}
console.log("Array.from, null, in a list, not read:", often34());
function scene35(turn) {
  const copy = Array.from([null, 2]);
  return [copy[1], JSON.stringify({ copy })];
}
function often35() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene35(turn);
  return last;
}
console.log("Array.from, null, in an object, read:", often35());
function scene36(turn) {
  const copy = Array.from([null, 2]);
  return [0, JSON.stringify({ copy })];
}
function often36() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene36(turn);
  return last;
}
console.log("Array.from, null, in an object, not read:", often36());
function scene37(turn) {
  const copy = Array.from([() => 1, 2]);
  return [copy[1], JSON.stringify(copy)];
}
function often37() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene37(turn);
  return last;
}
console.log("Array.from, a function, at the top, read:", often37());
function scene38(turn) {
  const copy = Array.from([() => 1, 2]);
  return [0, JSON.stringify(copy)];
}
function often38() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene38(turn);
  return last;
}
console.log("Array.from, a function, at the top, not read:", often38());
function scene39(turn) {
  const copy = Array.from([() => 1, 2]);
  return [copy[1], JSON.stringify([copy])];
}
function often39() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene39(turn);
  return last;
}
console.log("Array.from, a function, in a list, read:", often39());
function scene40(turn) {
  const copy = Array.from([() => 1, 2]);
  return [0, JSON.stringify([copy])];
}
function often40() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene40(turn);
  return last;
}
console.log("Array.from, a function, in a list, not read:", often40());
function scene41(turn) {
  const copy = Array.from([() => 1, 2]);
  return [copy[1], JSON.stringify({ copy })];
}
function often41() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene41(turn);
  return last;
}
console.log("Array.from, a function, in an object, read:", often41());
function scene42(turn) {
  const copy = Array.from([() => 1, 2]);
  return [0, JSON.stringify({ copy })];
}
function often42() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene42(turn);
  return last;
}
console.log("Array.from, a function, in an object, not read:", often42());
function scene43(turn) {
  const copy = Array.from([Symbol.iterator, 2]);
  return [copy[1], JSON.stringify(copy)];
}
function often43() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene43(turn);
  return last;
}
console.log("Array.from, a symbol, at the top, read:", often43());
function scene44(turn) {
  const copy = Array.from([Symbol.iterator, 2]);
  return [0, JSON.stringify(copy)];
}
function often44() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene44(turn);
  return last;
}
console.log("Array.from, a symbol, at the top, not read:", often44());
function scene45(turn) {
  const copy = Array.from([Symbol.iterator, 2]);
  return [copy[1], JSON.stringify([copy])];
}
function often45() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene45(turn);
  return last;
}
console.log("Array.from, a symbol, in a list, read:", often45());
function scene46(turn) {
  const copy = Array.from([Symbol.iterator, 2]);
  return [0, JSON.stringify([copy])];
}
function often46() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene46(turn);
  return last;
}
console.log("Array.from, a symbol, in a list, not read:", often46());
function scene47(turn) {
  const copy = Array.from([Symbol.iterator, 2]);
  return [copy[1], JSON.stringify({ copy })];
}
function often47() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene47(turn);
  return last;
}
console.log("Array.from, a symbol, in an object, read:", often47());
function scene48(turn) {
  const copy = Array.from([Symbol.iterator, 2]);
  return [0, JSON.stringify({ copy })];
}
function often48() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene48(turn);
  return last;
}
console.log("Array.from, a symbol, in an object, not read:", often48());
function scene49(turn) {
  const copy = Array.from([, 2]);
  return [copy[1], JSON.stringify(copy)];
}
function often49() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene49(turn);
  return last;
}
console.log("Array.from, a hole, at the top, read:", often49());
function scene50(turn) {
  const copy = Array.from([, 2]);
  return [0, JSON.stringify(copy)];
}
function often50() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene50(turn);
  return last;
}
console.log("Array.from, a hole, at the top, not read:", often50());
function scene51(turn) {
  const copy = Array.from([, 2]);
  return [copy[1], JSON.stringify([copy])];
}
function often51() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene51(turn);
  return last;
}
console.log("Array.from, a hole, in a list, read:", often51());
function scene52(turn) {
  const copy = Array.from([, 2]);
  return [0, JSON.stringify([copy])];
}
function often52() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene52(turn);
  return last;
}
console.log("Array.from, a hole, in a list, not read:", often52());
function scene53(turn) {
  const copy = Array.from([, 2]);
  return [copy[1], JSON.stringify({ copy })];
}
function often53() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene53(turn);
  return last;
}
console.log("Array.from, a hole, in an object, read:", often53());
function scene54(turn) {
  const copy = Array.from([, 2]);
  return [0, JSON.stringify({ copy })];
}
function often54() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene54(turn);
  return last;
}
console.log("Array.from, a hole, in an object, not read:", often54());
function scene55(turn) {
  const copy = Array.of(undefined, 1.5);
  return [copy[1], JSON.stringify(copy)];
}
function often55() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene55(turn);
  return last;
}
console.log("Array.of(undefined, 1.5), the last:", often55());
function scene56(turn) {
  const copy = Array.of(undefined, 1.5);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often56() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene56(turn);
  return last;
}
console.log("Array.of(undefined, 1.5), a sum:", often56());
function scene57(turn) {
  const copy = Array.of(1.5, undefined);
  return [copy[1], JSON.stringify(copy)];
}
function often57() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene57(turn);
  return last;
}
console.log("Array.of(1.5, undefined), the last:", often57());
function scene58(turn) {
  const copy = Array.of(1.5, undefined);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often58() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene58(turn);
  return last;
}
console.log("Array.of(1.5, undefined), a sum:", often58());
function scene59(turn) {
  const copy = Array.of(undefined, 1.5, 2.5);
  return [copy[2], JSON.stringify(copy)];
}
function often59() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene59(turn);
  return last;
}
console.log("Array.of(undefined, 1.5, 2.5), the last:", often59());
function scene60(turn) {
  const copy = Array.of(undefined, 1.5, 2.5);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often60() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene60(turn);
  return last;
}
console.log("Array.of(undefined, 1.5, 2.5), a sum:", often60());
function scene61(turn) {
  const copy = Array.of(2, undefined, 3);
  return [copy[2], JSON.stringify(copy)];
}
function often61() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene61(turn);
  return last;
}
console.log("Array.of(2, undefined, 3), the last:", often61());
function scene62(turn) {
  const copy = Array.of(2, undefined, 3);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often62() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene62(turn);
  return last;
}
console.log("Array.of(2, undefined, 3), a sum:", often62());
function scene63(turn) {
  const copy = Array.of(undefined, undefined, 2);
  return [copy[2], JSON.stringify(copy)];
}
function often63() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene63(turn);
  return last;
}
console.log("Array.of(undefined, undefined, 2), the last:", often63());
function scene64(turn) {
  const copy = Array.of(undefined, undefined, 2);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often64() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene64(turn);
  return last;
}
console.log("Array.of(undefined, undefined, 2), a sum:", often64());
function scene65(turn) {
  const copy = Array.of(undefined, NaN);
  return [copy[1], JSON.stringify(copy)];
}
function often65() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene65(turn);
  return last;
}
console.log("Array.of(undefined, NaN), the last:", often65());
function scene66(turn) {
  const copy = Array.of(undefined, NaN);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often66() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene66(turn);
  return last;
}
console.log("Array.of(undefined, NaN), a sum:", often66());
function scene67(turn) {
  const copy = Array.of(undefined, -0);
  return [copy[1], JSON.stringify(copy)];
}
function often67() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene67(turn);
  return last;
}
console.log("Array.of(undefined, -0), the last:", often67());
function scene68(turn) {
  const copy = Array.of(undefined, -0);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often68() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene68(turn);
  return last;
}
console.log("Array.of(undefined, -0), a sum:", often68());
function scene69(turn) {
  const copy = Array.of(undefined, 2 ** 31);
  return [copy[1], JSON.stringify(copy)];
}
function often69() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene69(turn);
  return last;
}
console.log("Array.of(undefined, 2 ** 31), the last:", often69());
function scene70(turn) {
  const copy = Array.of(undefined, 2 ** 31);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often70() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene70(turn);
  return last;
}
console.log("Array.of(undefined, 2 ** 31), a sum:", often70());
function scene71(turn) {
  const copy = Array.of(undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  return [copy[9], JSON.stringify(copy)];
}
function often71() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene71(turn);
  return last;
}
console.log("Array.of(undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9), the last:", often71());
function scene72(turn) {
  const copy = Array.of(undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  let sum = 0;
  for (const value of copy) if (value !== undefined) sum += value;
  return [sum, JSON.stringify(copy)];
}
function often72() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene72(turn);
  return last;
}
console.log("Array.of(undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9), a sum:", often72());
function scene73(turn) {
  const copy = Array.from({ length: 3 }, (_, index) => (turn === 399 && index === 1 ? undefined : index));
  return [copy[2], JSON.stringify(copy)];
}
function often73() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene73(turn);
  return last;
}
console.log("Array.from with a function that seldom gives undefined:", often73());
function scene74(turn) {
  const copy = Array.of(turn === 399 ? undefined : 1, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often74() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene74(turn);
  return last;
}
console.log("Array.of whose first argument is seldom undefined:", often74());
function scene75(turn) {
  const copy = Array.of(...[undefined, 2, 3]);
  return [copy[2], JSON.stringify(copy)];
}
function often75() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene75(turn);
  return last;
}
console.log("a spread of numbers and undefined into Array.of:", often75());
function scene76(turn) {
  const copy = Array.from({ length: 3 }, (_, index) => (turn === 399 && index === 1 ? "x" : index));
  return [copy[2], JSON.stringify(copy)];
}
function often76() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene76(turn);
  return last;
}
console.log("Array.from with a function that seldom gives a text:", often76());
function scene77(turn) {
  const copy = Array.of(turn === 399 ? "x" : 1, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often77() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene77(turn);
  return last;
}
console.log("Array.of whose first argument is seldom a text:", often77());
function scene78(turn) {
  const copy = Array.of(...["x", 2, 3]);
  return [copy[2], JSON.stringify(copy)];
}
function often78() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene78(turn);
  return last;
}
console.log("a spread of numbers and a text into Array.of:", often78());
function scene79(turn) {
  const copy = Array.from({ length: 3 }, (_, index) => (turn === 399 && index === 1 ? { a: 1 } : index));
  return [copy[2], JSON.stringify(copy)];
}
function often79() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene79(turn);
  return last;
}
console.log("Array.from with a function that seldom gives an object:", often79());
function scene80(turn) {
  const copy = Array.of(turn === 399 ? { a: 1 } : 1, 2);
  return [copy[1], JSON.stringify(copy)];
}
function often80() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene80(turn);
  return last;
}
console.log("Array.of whose first argument is seldom an object:", often80());
function scene81(turn) {
  const copy = Array.of(...[{ a: 1 }, 2, 3]);
  return [copy[2], JSON.stringify(copy)];
}
function often81() {
  let last;
  for (let turn = 0; turn < 400; turn++) last = scene81(turn);
  return last;
}
console.log("a spread of numbers and an object into Array.of:", often81());
