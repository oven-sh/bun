// STATISTIC: InlineeArrayStoresLeftGeneric >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };
const births = +process.argv[2] || 4;

const kept = [];
const rows0 = []; for (let i = 0; i < 7; i++) rows0.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick0() { return rows0.map(row => row.v); }
{ const deed = list => {}; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick0(); said.push(hold(list, rows0, row => row.v, 'nothing:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('nothing', 0, new Set(said).size, said[births - 1]); }
const rows1 = []; for (let i = 0; i < 7; i++) rows1.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick1() { return rows1.map(row => row.v); }
{ const deed = list => {}; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick1(); said.push(hold(list, rows1, row => row.v, 'nothing:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('nothing', 1, new Set(said).size, said[births - 1]); }
const rows2 = []; for (let i = 0; i < 7; i++) rows2.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick2() { return rows2.map(row => row.v); }
{ const deed = list => {}; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick2(); said.push(hold(list, rows2, row => row.v, 'nothing:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('nothing', 2, new Set(said).size, said[births - 1]); }
const rows3 = []; for (let i = 0; i < 7; i++) rows3.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick3() { return rows3.map(row => row.v); }
{ const deed = list => { list[1] = 'written'; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick3(); said.push(hold(list, rows3, row => row.v, 'a text written into it:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a text written into it', 3, new Set(said).size, said[births - 1]); }
const rows4 = []; for (let i = 0; i < 7; i++) rows4.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick4() { return rows4.map(row => row.v); }
{ const deed = list => { list[1] = 'written'; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick4(); said.push(hold(list, rows4, row => row.v, 'a text written into it:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a text written into it', 4, new Set(said).size, said[births - 1]); }
const rows5 = []; for (let i = 0; i < 7; i++) rows5.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick5() { return rows5.map(row => row.v); }
{ const deed = list => { list[1] = 'written'; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick5(); said.push(hold(list, rows5, row => row.v, 'a text written into it:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a text written into it', 5, new Set(said).size, said[births - 1]); }
const rows6 = []; for (let i = 0; i < 7; i++) rows6.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick6() { return rows6.map(row => row.v); }
{ const deed = list => { list.length = 0; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick6(); said.push(hold(list, rows6, row => row.v, 'emptied:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('emptied', 6, new Set(said).size, said[births - 1]); }
const rows7 = []; for (let i = 0; i < 7; i++) rows7.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick7() { return rows7.map(row => row.v); }
{ const deed = list => { list.length = 0; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick7(); said.push(hold(list, rows7, row => row.v, 'emptied:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('emptied', 7, new Set(said).size, said[births - 1]); }
const rows8 = []; for (let i = 0; i < 7; i++) rows8.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick8() { return rows8.map(row => row.v); }
{ const deed = list => { list.length = 0; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick8(); said.push(hold(list, rows8, row => row.v, 'emptied:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('emptied', 8, new Set(said).size, said[births - 1]); }
const rows9 = []; for (let i = 0; i < 7; i++) rows9.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick9() { return rows9.map(row => row.v); }
{ const deed = list => { Object.freeze(list); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick9(); said.push(hold(list, rows9, row => row.v, 'frozen:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('frozen', 9, new Set(said).size, said[births - 1]); }
const rows10 = []; for (let i = 0; i < 7; i++) rows10.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick10() { return rows10.map(row => row.v); }
{ const deed = list => { Object.freeze(list); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick10(); said.push(hold(list, rows10, row => row.v, 'frozen:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('frozen', 10, new Set(said).size, said[births - 1]); }
const rows11 = []; for (let i = 0; i < 7; i++) rows11.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick11() { return rows11.map(row => row.v); }
{ const deed = list => { Object.freeze(list); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick11(); said.push(hold(list, rows11, row => row.v, 'frozen:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('frozen', 11, new Set(said).size, said[births - 1]); }
const rows12 = []; for (let i = 0; i < 7; i++) rows12.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick12() { return rows12.map(row => row.v); }
{ const deed = list => { list[100000] = 1; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick12(); said.push(hold(list, rows12, row => row.v, 'made sparse:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('made sparse', 12, new Set(said).size, said[births - 1]); }
const rows13 = []; for (let i = 0; i < 7; i++) rows13.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick13() { return rows13.map(row => row.v); }
{ const deed = list => { list[100000] = 1; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick13(); said.push(hold(list, rows13, row => row.v, 'made sparse:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('made sparse', 13, new Set(said).size, said[births - 1]); }
const rows14 = []; for (let i = 0; i < 7; i++) rows14.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick14() { return rows14.map(row => row.v); }
{ const deed = list => { list[100000] = 1; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick14(); said.push(hold(list, rows14, row => row.v, 'made sparse:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('made sparse', 14, new Set(said).size, said[births - 1]); }
const rows15 = []; for (let i = 0; i < 7; i++) rows15.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick15() { return rows15.map(row => row.v); }
{ const deed = list => { delete list[2]; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick15(); said.push(hold(list, rows15, row => row.v, 'a hole made:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a hole made', 15, new Set(said).size, said[births - 1]); }
const rows16 = []; for (let i = 0; i < 7; i++) rows16.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick16() { return rows16.map(row => row.v); }
{ const deed = list => { delete list[2]; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick16(); said.push(hold(list, rows16, row => row.v, 'a hole made:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a hole made', 16, new Set(said).size, said[births - 1]); }
const rows17 = []; for (let i = 0; i < 7; i++) rows17.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick17() { return rows17.map(row => row.v); }
{ const deed = list => { delete list[2]; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick17(); said.push(hold(list, rows17, row => row.v, 'a hole made:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a hole made', 17, new Set(said).size, said[births - 1]); }
const rows18 = []; for (let i = 0; i < 7; i++) rows18.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick18() { return rows18.map(row => row.v); }
{ const deed = list => { list[0] = NaN; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick18(); said.push(hold(list, rows18, row => row.v, 'NaN written:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('NaN written', 18, new Set(said).size, said[births - 1]); }
const rows19 = []; for (let i = 0; i < 7; i++) rows19.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick19() { return rows19.map(row => row.v); }
{ const deed = list => { list[0] = NaN; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick19(); said.push(hold(list, rows19, row => row.v, 'NaN written:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('NaN written', 19, new Set(said).size, said[births - 1]); }
const rows20 = []; for (let i = 0; i < 7; i++) rows20.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick20() { return rows20.map(row => row.v); }
{ const deed = list => { list[0] = NaN; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick20(); said.push(hold(list, rows20, row => row.v, 'NaN written:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('NaN written', 20, new Set(said).size, said[births - 1]); }
const rows21 = []; for (let i = 0; i < 7; i++) rows21.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick21() { return rows21.map(row => row.v); }
{ const deed = list => { list[3] = 0.25; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick21(); said.push(hold(list, rows21, row => row.v, 'a fraction written:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a fraction written', 21, new Set(said).size, said[births - 1]); }
const rows22 = []; for (let i = 0; i < 7; i++) rows22.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick22() { return rows22.map(row => row.v); }
{ const deed = list => { list[3] = 0.25; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick22(); said.push(hold(list, rows22, row => row.v, 'a fraction written:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a fraction written', 22, new Set(said).size, said[births - 1]); }
const rows23 = []; for (let i = 0; i < 7; i++) rows23.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick23() { return rows23.map(row => row.v); }
{ const deed = list => { list[3] = 0.25; }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick23(); said.push(hold(list, rows23, row => row.v, 'a fraction written:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('a fraction written', 23, new Set(said).size, said[births - 1]); }
const rows24 = []; for (let i = 0; i < 7; i++) rows24.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick24() { return rows24.map(row => row.v); }
{ const deed = list => { for (let i = 0; i < 40; i++) list.push(i); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick24(); said.push(hold(list, rows24, row => row.v, 'grown:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('grown', 24, new Set(said).size, said[births - 1]); }
const rows25 = []; for (let i = 0; i < 7; i++) rows25.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick25() { return rows25.map(row => row.v); }
{ const deed = list => { for (let i = 0; i < 40; i++) list.push(i); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick25(); said.push(hold(list, rows25, row => row.v, 'grown:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('grown', 25, new Set(said).size, said[births - 1]); }
const rows26 = []; for (let i = 0; i < 7; i++) rows26.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick26() { return rows26.map(row => row.v); }
{ const deed = list => { for (let i = 0; i < 40; i++) list.push(i); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick26(); said.push(hold(list, rows26, row => row.v, 'grown:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('grown', 26, new Set(said).size, said[births - 1]); }
const rows27 = []; for (let i = 0; i < 7; i++) rows27.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick27() { return rows27.map(row => row.v); }
{ const deed = list => { Object.defineProperty(list, 1, { get() { return 7; }, configurable: true }); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick27(); said.push(hold(list, rows27, row => row.v, 'an accessor laid:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('an accessor laid', 27, new Set(said).size, said[births - 1]); }
const rows28 = []; for (let i = 0; i < 7; i++) rows28.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick28() { return rows28.map(row => row.v); }
{ const deed = list => { Object.defineProperty(list, 1, { get() { return 7; }, configurable: true }); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick28(); said.push(hold(list, rows28, row => row.v, 'an accessor laid:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('an accessor laid', 28, new Set(said).size, said[births - 1]); }
const rows29 = []; for (let i = 0; i < 7; i++) rows29.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick29() { return rows29.map(row => row.v); }
{ const deed = list => { Object.defineProperty(list, 1, { get() { return 7; }, configurable: true }); }; const said = []; for (let birth = 0; birth < births; birth++) { const list = pick29(); said.push(hold(list, rows29, row => row.v, 'an accessor laid:' + birth)); if (!birth) { deed(list); kept.push(list); } } console.log('an accessor laid', 29, new Set(said).size, said[births - 1]); }
console.log(kept.length, wrong);
