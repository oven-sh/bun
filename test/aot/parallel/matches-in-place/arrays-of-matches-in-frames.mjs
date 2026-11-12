// The array of a match that is read by index is made all the same where the program may have stored an exec: of the bounds in the frame.
const subjects = ["alpha-12", "bat", "ba", "", "2026-11-10", "a-bc", "xx", "\u0101b-1", "abcdefghijklmnopqrstuvwxyz", "x".repeat(70) + "-7"];
const ropes = subjects.map((s, i) => s + String(i));
const pieces = subjects.map(s => ("xy" + s + "zw").slice(2, 2 + s.length));
const all = [...subjects, ...ropes, ...pieces];
const re0 = /^ba/;
function Exec0(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run0(list) { const out = []; for (let i = 0; i < list.length; i++) { re0.lastIndex = 0; out.push(Exec0(re0, list[i])); } return out.join(); }
function own0() { re0.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re1 = /(\w)-(\w)?(\w)?/;
function Exec1(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run1(list) { const out = []; for (let i = 0; i < list.length; i++) { re1.lastIndex = 0; out.push(Exec1(re1, list[i])); } return out.join(); }
function own1() { re1.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re2 = /(?<y>\d{4})-(?<m>\d\d)/;
function Exec2(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run2(list) { const out = []; for (let i = 0; i < list.length; i++) { re2.lastIndex = 0; out.push(Exec2(re2, list[i])); } return out.join(); }
function own2() { re2.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re3 = /(?<a>b)|(?<a>x)/;
function Exec3(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run3(list) { const out = []; for (let i = 0; i < list.length; i++) { re3.lastIndex = 0; out.push(Exec3(re3, list[i])); } return out.join(); }
function own3() { re3.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re4 = /b(a)?/y;
function Exec4(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run4(list) { const out = []; for (let i = 0; i < list.length; i++) { re4.lastIndex = 0; out.push(Exec4(re4, list[i])); } return out.join(); }
function own4() { re4.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re5 = /(\d)/g;
function Exec5(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run5(list) { const out = []; for (let i = 0; i < list.length; i++) { re5.lastIndex = 0; out.push(Exec5(re5, list[i])); } return out.join(); }
function own5() { re5.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re6 = /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)(o)(p)(q)/;
function Exec6(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run6(list) { const out = []; for (let i = 0; i < list.length; i++) { re6.lastIndex = 0; out.push(Exec6(re6, list[i])); } return out.join(); }
function own6() { re6.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re7 = /x/;
function Exec7(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run7(list) { const out = []; for (let i = 0; i < list.length; i++) { re7.lastIndex = 0; out.push(Exec7(re7, list[i])); } return out.join(); }
function own7() { re7.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
const re8 = /[^a]*/;
function Exec8(re, string) { let sum = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function run8(list) { const out = []; for (let i = 0; i < list.length; i++) { re8.lastIndex = 0; out.push(Exec8(re8, list[i])); } return out.join(); }
function own8() { re8.exec = function (s) { return s.length > 3 ? [s, undefined, "z"] : null; }; }
console.log(run0(all), re0.lastIndex); own0(); console.log(run0(all));
console.log(run1(all), re1.lastIndex); own1(); console.log(run1(all));
console.log(run2(all), re2.lastIndex); own2(); console.log(run2(all));
console.log(run3(all), re3.lastIndex); own3(); console.log(run3(all));
console.log(run4(all), re4.lastIndex); own4(); console.log(run4(all));
console.log(run5(all), re5.lastIndex); own5(); console.log(run5(all));
console.log(run6(all), re6.lastIndex); own6(); console.log(run6(all));
console.log(run7(all), re7.lastIndex); own7(); console.log(run7(all));
console.log(run8(all), re8.lastIndex); own8(); console.log(run8(all));
