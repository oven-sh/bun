const given = JSON.parse('{"text":"7","name":"constructor"}');
function twice(count) { return count * 2; }
function make0() { return function (count) { return twice(count) + 0; }; }
function make1() { return function (count) { return twice(count) + 1; }; }
function make2() { return function (count) { return twice(count) + 2; }; }
function make3() { return function (count) { return twice(count) + 3; }; }
function make4() { return function (count) { return twice(count) + 4; }; }
function make5() { return function (count) { return twice(count) + 5; }; }
function make6() { return function (count) { return twice(count) + 6; }; }
function make7() { return function (count) { return twice(count) + 7; }; }
function make8() { return function (count) { return twice(count) + 8; }; }
function make9() { return function (count) { return twice(count) + 9; }; }
function make10() { return function (count) { return twice(count) + 10; }; }
function make11() { return function (count) { return twice(count) + 11; }; }
function make12() { return function (count) { return twice(count) + 12; }; }
function make13() { return function (count) { return twice(count) + 13; }; }
function make14() { return function (count) { return twice(count) + 14; }; }
function make15() { return function (count) { return twice(count) + 15; }; }
function make16() { return function (count) { return twice(count) + 16; }; }
function make17() { return function (count) { return twice(count) + 17; }; }
function make18() { return function (count) { return twice(count) + 18; }; }
function make19() { return function (count) { return twice(count) + 19; }; }
function make20() { return function (count) { return twice(count) + 20; }; }
function make21() { return function (count) { return twice(count) + 21; }; }
function make22() { return function (count) { return twice(count) + 22; }; }
function make23() { return function (count) { return twice(count) + 23; }; }
function make24() { return function (count) { return twice(count) + 24; }; }
function make25() { return function (count) { return twice(count) + 25; }; }
function make26() { return function (count) { return twice(count) + 26; }; }
function make27() { return function (count) { return twice(count) + 27; }; }
function make28() { return function (count) { return twice(count) + 28; }; }
function make29() { return function (count) { return twice(count) + 29; }; }
function make30() { return function (count) { return twice(count) + 30; }; }
function make31() { return function (count) { return twice(count) + 31; }; }
function make32() { return function (count) { return twice(count) + 32; }; }
function make33() { return function (count) { return twice(count) + 33; }; }
function make34() { return function (count) { return twice(count) + 34; }; }
function make35() { return function (count) { return twice(count) + 35; }; }
function make36() { return function (count) { return twice(count) + 36; }; }
function make37() { return function (count) { return twice(count) + 37; }; }
function make38() { return function (count) { return twice(count) + 38; }; }
function make39() { return function (count) { return twice(count) + 39; }; }
const all = [make0(), make1(), make2(), make3(), make4(), make5(), make6(), make7(), make8(), make9(), make10(), make11(), make12(), make13(), make14(), make15(), make16(), make17(), make18(), make19(), make20(), make21(), make22(), make23(), make24(), make25(), make26(), make27(), make28(), make29(), make30(), make31(), make32(), make33(), make34(), make35(), make36(), make37(), make38(), make39()], said = [];
for (let turn = 0; turn < 40; turn++) { const Either = all[turn], again = new Either(turn)[given.name]; again.mark = turn; said.push(again === Either, again(given.text)); }
for (const each of all) said.push(each.mark);
console.log("SAID " + said.join().length + " " + said.slice(0, 6).join());
