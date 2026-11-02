// What slice, concat, splice and the copying methods make has a hole exactly where the list that they copy has one. Each result has a function of its own that reads it index by index, in a loop, so that nothing else decides what is known of it.
function read1(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read1(S.slice()); } console.log("dense slice", text); }
function read2(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read2(S.slice(1, 3)); } console.log("dense slicePart", text); }
function read3(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read3(S.concat([7, 8])); } console.log("dense concat", text); }
function read4(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read4([7, 8].concat(S)); } console.log("dense concatInto", text); }
function read5(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read5(S.concat(9)); } console.log("dense concatValue", text); }
function read6(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read6(S.splice(0, 3)); } console.log("dense splice", text); }
function read7(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read7(S.toSpliced(0, 1)); } console.log("dense toSpliced", text); }
function read8(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read8(S.toReversed()); } console.log("dense toReversed", text); }
function read9(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read9(S.toSorted()); } console.log("dense toSorted", text); }
function read10(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read10(S.with(0, 9)); } console.log("dense with", text); }
function read11(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read11(S.slice().slice()); } console.log("dense twice", text); }
function read12(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2, 3, 4]; text = read12(Array.prototype.slice.call(S)); } console.log("dense call", text); }
function read13(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read13(S.slice()); } console.log("literalWithHole slice", text); }
function read14(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read14(S.slice(1, 3)); } console.log("literalWithHole slicePart", text); }
function read15(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read15(S.concat([7, 8])); } console.log("literalWithHole concat", text); }
function read16(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read16([7, 8].concat(S)); } console.log("literalWithHole concatInto", text); }
function read17(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read17(S.concat(9)); } console.log("literalWithHole concatValue", text); }
function read18(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read18(S.splice(0, 3)); } console.log("literalWithHole splice", text); }
function read19(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read19(S.toSpliced(0, 1)); } console.log("literalWithHole toSpliced", text); }
function read20(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read20(S.toReversed()); } console.log("literalWithHole toReversed", text); }
function read21(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read21(S.toSorted()); } console.log("literalWithHole toSorted", text); }
function read22(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read22(S.with(0, 9)); } console.log("literalWithHole with", text); }
function read23(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read23(S.slice().slice()); } console.log("literalWithHole twice", text); }
function read24(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4]; text = read24(Array.prototype.slice.call(S)); } console.log("literalWithHole call", text); }
function read25(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read25(S.slice()); } console.log("made slice", text); }
function read26(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read26(S.slice(1, 3)); } console.log("made slicePart", text); }
function read27(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read27(S.concat([7, 8])); } console.log("made concat", text); }
function read28(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read28([7, 8].concat(S)); } console.log("made concatInto", text); }
function read29(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read29(S.concat(9)); } console.log("made concatValue", text); }
function read30(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read30(S.splice(0, 3)); } console.log("made splice", text); }
function read31(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read31(S.toSpliced(0, 1)); } console.log("made toSpliced", text); }
function read32(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read32(S.toReversed()); } console.log("made toReversed", text); }
function read33(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read33(S.toSorted()); } console.log("made toSorted", text); }
function read34(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read34(S.with(0, 9)); } console.log("made with", text); }
function read35(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read35(S.slice().slice()); } console.log("made twice", text); }
function read36(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = new Array(4); a[0] = 1; return a; })(); text = read36(Array.prototype.slice.call(S)); } console.log("made call", text); }
function read37(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read37(S.slice()); } console.log("deleted slice", text); }
function read38(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read38(S.slice(1, 3)); } console.log("deleted slicePart", text); }
function read39(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read39(S.concat([7, 8])); } console.log("deleted concat", text); }
function read40(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read40([7, 8].concat(S)); } console.log("deleted concatInto", text); }
function read41(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read41(S.concat(9)); } console.log("deleted concatValue", text); }
function read42(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read42(S.splice(0, 3)); } console.log("deleted splice", text); }
function read43(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read43(S.toSpliced(0, 1)); } console.log("deleted toSpliced", text); }
function read44(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read44(S.toReversed()); } console.log("deleted toReversed", text); }
function read45(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read45(S.toSorted()); } console.log("deleted toSorted", text); }
function read46(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read46(S.with(0, 9)); } console.log("deleted with", text); }
function read47(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read47(S.slice().slice()); } console.log("deleted twice", text); }
function read48(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; delete a[1]; return a; })(); text = read48(Array.prototype.slice.call(S)); } console.log("deleted call", text); }
function read49(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read49(S.slice()); } console.log("longer slice", text); }
function read50(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read50(S.slice(1, 3)); } console.log("longer slicePart", text); }
function read51(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read51(S.concat([7, 8])); } console.log("longer concat", text); }
function read52(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read52([7, 8].concat(S)); } console.log("longer concatInto", text); }
function read53(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read53(S.concat(9)); } console.log("longer concatValue", text); }
function read54(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read54(S.splice(0, 3)); } console.log("longer splice", text); }
function read55(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read55(S.toSpliced(0, 1)); } console.log("longer toSpliced", text); }
function read56(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read56(S.toReversed()); } console.log("longer toReversed", text); }
function read57(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read57(S.toSorted()); } console.log("longer toSorted", text); }
function read58(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read58(S.with(0, 9)); } console.log("longer with", text); }
function read59(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read59(S.slice().slice()); } console.log("longer twice", text); }
function read60(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a.length = 4; return a; })(); text = read60(Array.prototype.slice.call(S)); } console.log("longer call", text); }
function read61(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read61(S.slice()); } console.log("far slice", text); }
function read62(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read62(S.slice(1, 3)); } console.log("far slicePart", text); }
function read63(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read63(S.concat([7, 8])); } console.log("far concat", text); }
function read64(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read64([7, 8].concat(S)); } console.log("far concatInto", text); }
function read65(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read65(S.concat(9)); } console.log("far concatValue", text); }
function read66(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read66(S.splice(0, 3)); } console.log("far splice", text); }
function read67(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read67(S.toSpliced(0, 1)); } console.log("far toSpliced", text); }
function read68(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read68(S.toReversed()); } console.log("far toReversed", text); }
function read69(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read69(S.toSorted()); } console.log("far toSorted", text); }
function read70(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read70(S.with(0, 9)); } console.log("far with", text); }
function read71(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read71(S.slice().slice()); } console.log("far twice", text); }
function read72(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2]; a[5] = 6; return a; })(); text = read72(Array.prototype.slice.call(S)); } console.log("far call", text); }
function read73(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read73(S.slice()); } console.log("shrunk slice", text); }
function read74(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read74(S.slice(1, 3)); } console.log("shrunk slicePart", text); }
function read75(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read75(S.concat([7, 8])); } console.log("shrunk concat", text); }
function read76(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read76([7, 8].concat(S)); } console.log("shrunk concatInto", text); }
function read77(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read77(S.concat(9)); } console.log("shrunk concatValue", text); }
function read78(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read78(S.splice(0, 3)); } console.log("shrunk splice", text); }
function read79(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read79(S.toSpliced(0, 1)); } console.log("shrunk toSpliced", text); }
function read80(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read80(S.toReversed()); } console.log("shrunk toReversed", text); }
function read81(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read81(S.toSorted()); } console.log("shrunk toSorted", text); }
function read82(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read82(S.with(0, 9)); } console.log("shrunk with", text); }
function read83(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read83(S.slice().slice()); } console.log("shrunk twice", text); }
function read84(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.length = 1; a.length = 3; return a; })(); text = read84(Array.prototype.slice.call(S)); } console.log("shrunk call", text); }
function read85(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read85(S.slice()); } console.log("popped slice", text); }
function read86(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read86(S.slice(1, 3)); } console.log("popped slicePart", text); }
function read87(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read87(S.concat([7, 8])); } console.log("popped concat", text); }
function read88(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read88([7, 8].concat(S)); } console.log("popped concatInto", text); }
function read89(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read89(S.concat(9)); } console.log("popped concatValue", text); }
function read90(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read90(S.splice(0, 3)); } console.log("popped splice", text); }
function read91(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read91(S.toSpliced(0, 1)); } console.log("popped toSpliced", text); }
function read92(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read92(S.toReversed()); } console.log("popped toReversed", text); }
function read93(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read93(S.toSorted()); } console.log("popped toSorted", text); }
function read94(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read94(S.with(0, 9)); } console.log("popped with", text); }
function read95(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read95(S.slice().slice()); } console.log("popped twice", text); }
function read96(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3, 4]; a.pop(); a[3] = 4; a.pop(); a.pop(); a[3] = 9; return a; })(); text = read96(Array.prototype.slice.call(S)); } console.log("popped call", text); }
function read97(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read97(S.slice()); } console.log("filled slice", text); }
function read98(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read98(S.slice(1, 3)); } console.log("filled slicePart", text); }
function read99(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read99(S.concat([7, 8])); } console.log("filled concat", text); }
function read100(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read100([7, 8].concat(S)); } console.log("filled concatInto", text); }
function read101(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read101(S.concat(9)); } console.log("filled concatValue", text); }
function read102(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read102(S.splice(0, 3)); } console.log("filled splice", text); }
function read103(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read103(S.toSpliced(0, 1)); } console.log("filled toSpliced", text); }
function read104(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read104(S.toReversed()); } console.log("filled toReversed", text); }
function read105(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read105(S.toSorted()); } console.log("filled toSorted", text); }
function read106(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read106(S.with(0, 9)); } console.log("filled with", text); }
function read107(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read107(S.slice().slice()); } console.log("filled twice", text); }
function read108(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, 2, 3]; a.fill(0); return a; })(); text = read108(Array.prototype.slice.call(S)); } console.log("filled call", text); }
function read109(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read109(S.slice()); } console.log("copied slice", text); }
function read110(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read110(S.slice(1, 3)); } console.log("copied slicePart", text); }
function read111(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read111(S.concat([7, 8])); } console.log("copied concat", text); }
function read112(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read112([7, 8].concat(S)); } console.log("copied concatInto", text); }
function read113(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read113(S.concat(9)); } console.log("copied concatValue", text); }
function read114(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read114(S.splice(0, 3)); } console.log("copied splice", text); }
function read115(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read115(S.toSpliced(0, 1)); } console.log("copied toSpliced", text); }
function read116(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read116(S.toReversed()); } console.log("copied toReversed", text); }
function read117(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read117(S.toSorted()); } console.log("copied toSorted", text); }
function read118(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read118(S.with(0, 9)); } console.log("copied with", text); }
function read119(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read119(S.slice().slice()); } console.log("copied twice", text); }
function read120(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.copyWithin(0, 1); return a; })(); text = read120(Array.prototype.slice.call(S)); } console.log("copied call", text); }
function read121(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read121(S.slice()); } console.log("reversed slice", text); }
function read122(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read122(S.slice(1, 3)); } console.log("reversed slicePart", text); }
function read123(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read123(S.concat([7, 8])); } console.log("reversed concat", text); }
function read124(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read124([7, 8].concat(S)); } console.log("reversed concatInto", text); }
function read125(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read125(S.concat(9)); } console.log("reversed concatValue", text); }
function read126(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read126(S.splice(0, 3)); } console.log("reversed splice", text); }
function read127(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read127(S.toSpliced(0, 1)); } console.log("reversed toSpliced", text); }
function read128(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read128(S.toReversed()); } console.log("reversed toReversed", text); }
function read129(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read129(S.toSorted()); } console.log("reversed toSorted", text); }
function read130(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read130(S.with(0, 9)); } console.log("reversed with", text); }
function read131(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read131(S.slice().slice()); } console.log("reversed twice", text); }
function read132(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = (() => { const a = [1, , 3, 4]; a.reverse(); return a; })(); text = read132(Array.prototype.slice.call(S)); } console.log("reversed call", text); }
function read133(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read133(S.slice()); } console.log("sliceOfHole slice", text); }
function read134(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read134(S.slice(1, 3)); } console.log("sliceOfHole slicePart", text); }
function read135(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read135(S.concat([7, 8])); } console.log("sliceOfHole concat", text); }
function read136(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read136([7, 8].concat(S)); } console.log("sliceOfHole concatInto", text); }
function read137(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read137(S.concat(9)); } console.log("sliceOfHole concatValue", text); }
function read138(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read138(S.splice(0, 3)); } console.log("sliceOfHole splice", text); }
function read139(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read139(S.toSpliced(0, 1)); } console.log("sliceOfHole toSpliced", text); }
function read140(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read140(S.toReversed()); } console.log("sliceOfHole toReversed", text); }
function read141(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read141(S.toSorted()); } console.log("sliceOfHole toSorted", text); }
function read142(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read142(S.with(0, 9)); } console.log("sliceOfHole with", text); }
function read143(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read143(S.slice().slice()); } console.log("sliceOfHole twice", text); }
function read144(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, , 3, 4].slice(); text = read144(Array.prototype.slice.call(S)); } console.log("sliceOfHole call", text); }
function read145(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read145(S.slice()); } console.log("concatOfHole slice", text); }
function read146(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read146(S.slice(1, 3)); } console.log("concatOfHole slicePart", text); }
function read147(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read147(S.concat([7, 8])); } console.log("concatOfHole concat", text); }
function read148(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read148([7, 8].concat(S)); } console.log("concatOfHole concatInto", text); }
function read149(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read149(S.concat(9)); } console.log("concatOfHole concatValue", text); }
function read150(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read150(S.splice(0, 3)); } console.log("concatOfHole splice", text); }
function read151(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read151(S.toSpliced(0, 1)); } console.log("concatOfHole toSpliced", text); }
function read152(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read152(S.toReversed()); } console.log("concatOfHole toReversed", text); }
function read153(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read153(S.toSorted()); } console.log("concatOfHole toSorted", text); }
function read154(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read154(S.with(0, 9)); } console.log("concatOfHole with", text); }
function read155(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read155(S.slice().slice()); } console.log("concatOfHole twice", text); }
function read156(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { const S = [1, 2].concat([3, , 5]); text = read156(Array.prototype.slice.call(S)); } console.log("concatOfHole call", text); }
