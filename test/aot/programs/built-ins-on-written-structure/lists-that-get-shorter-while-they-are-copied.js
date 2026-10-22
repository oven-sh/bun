// What the methods that make a list make has holes where the specification leaves them: where the list that is copied has one, and where it has got shorter while a callback, a conversion or a getter ran. Each result has a function of its own that reads it index by index, in a loop.
function read0(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.slice({ valueOf() { a.length = 1; return 0; } }); text = read0(R); } console.log('slice whose start shrinks the list', text); }
function read1(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.slice(0, { valueOf() { a.pop(); a.pop(); return 4; } }); text = read1(R); } console.log('slice whose end pops the list', text); }
function read2(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.splice(0, { valueOf() { a.length = 1; return 4; } }); text = read2(R); } console.log('splice whose count shrinks the list', text); }
function read3(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.map(v => { a.pop(); return v; }); text = read3(R); } console.log('map whose callback pops the list', text); }
function read4(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.map(v => { a.length = 2; return v; }); text = read4(R); } console.log('map whose callback shortens the list', text); }
function read5(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.map(v => { delete a[2]; return v; }); text = read5(R); } console.log('map whose callback deletes', text); }
function read6(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, , 3, 4]; R = a.map(v => v); text = read6(R); } console.log('map of a list with a hole', text); }
function read7(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.map(v => v + 1); text = read7(R); } console.log('map of a dense list', text); }
function read8(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3]; R = a.map(v => { a.push(v); return v; }); text = read8(R); } console.log('map of a list that grows', text); }
function read9(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, , 3, 4]; R = a.filter(() => true); text = read9(R); } console.log('filter of a list with a hole', text); }
function read10(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4]; R = a.filter(() => { a.pop(); return true; }); text = read10(R); } console.log('filter whose callback pops', text); }
function read11(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, , 3]; R = a.flatMap(v => [v, , v]); text = read11(R); } console.log('flatMap of a list with a hole', text); }
function read12(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [[1, , 2], , [3]]; R = a.flat(); text = read12(R); } console.log('flat of lists with holes', text); }
function read13(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.from([1, , 3]); text = read13(R); } console.log('from a list with a hole', text); }
function read14(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.from({ length: 3, 1: 5 }); text = read14(R); } console.log('from an object with a length', text); }
function read15(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.from([1, , 3], v => v); text = read15(R); } console.log('from with a mapper', text); }
function read16(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.from(new Set([1, 2])); text = read16(R); } console.log('from a set', text); }
function read17(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = [3, , 1].toSorted(); text = read17(R); } console.log('toSorted of a list with a hole', text); }
function read18(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [3, 2, 1]; R = a.toSorted((x, y) => { a.pop(); return x - y; }); text = read18(R); } console.log('toSorted with a comparator that pops', text); }
function read19(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; const a = [1, 2, 3, 4], o = [5]; Object.defineProperty(o, Symbol.isConcatSpreadable, { get() { a.length = 1; return true; } }); R = [0].concat(o, a); text = read19(R); } console.log('concat whose operand has a getter that shrinks the receiver', text); }
function read20(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; class L extends Array {} const l = new L(); l[2] = 1; R = [0].concat(l); text = read20(R); } console.log('concat of a list below a class', text); }
function read21(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; class L extends Array {} const l = new L(); l[2] = 1; R = l.map(v => v); text = read21(R); } console.log('map of a list below a class', text); }
function read22(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; class L extends Array { static get [Symbol.species]() { return function (n) { return new Array(n + 2); }; } } const l = new L(); l.push(1, 2); R = l.slice(); text = read22(R); } console.log('slice by a species that makes a longer list', text); }
function read23(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = [1, 2].map(v => v); R[4] = 1; text = read23(R); } console.log('map, then a store past the end', text); }
function read24(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = [1, 2, 3].filter(() => true); delete R[1]; text = read24(R); } console.log('filter, then a delete', text); }
function read25(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.prototype.with.call({ length: 3, 0: 1 }, 1, 5); text = read25(R); } console.log('with on an object', text); }
function read26(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.prototype.toReversed.call({ length: 3, 0: 1 }); text = read26(R); } console.log('toReversed on an object', text); }
function read27(list) { let text = ""; for (let i = 0; i < list.length; i++) { const value = list[i]; text += value === undefined ? (i in list ? "u" : "-") : value; } return text; }
{ let text = ""; for (let round = 0; round < 300; round++) { let R; R = Array.prototype.toSpliced.call({ length: 3, 0: 1 }, 0, 1); text = read27(R); } console.log('toSpliced on an object', text); }
