globalThis.keep = [];
var nameOfField = new Function("return 'x'")();
globalThis.seen = [];
function F0(x) { this.x = x; }
F0.prototype.a = function (x) { return x + 1; };
F0.prototype.b = function (x) { return this.a(x) * 2; };
F0.prototype.c = function () { return this; };
F0.e = function () { return 5; };
keep.push(new F0(0));
function F1(x) { this.x = x; }
F1.prototype.a = function (x) { return x + 2; };
F1.prototype.b = function (x) { return this.a(x) * 2; };
F1.prototype.c = function () { return this; };
F1.e = function () { return 5; };
keep.push(new F1(1));
function F2(x) { this.x = x; }
F2.prototype.a = function (x) { return x + 3; };
F2.prototype.b = function (x) { return this.a(x) * 2; };
F2.prototype.c = function () { return this; };
F2.e = function () { return 5; };
keep.push(new F2(2));
function F3(x) { this.x = x; }
F3.prototype.a = function (x) { return x + 4; };
F3.prototype.b = function (x) { return this.a(x) * 2; };
F3.prototype.c = function () { return this; };
F3.e = function () { return 5; };
keep.push(new F3(3));
function F4(x) { this.x = x; }
F4.prototype.a = function (x) { return x + 5; };
F4.prototype.b = function (x) { return this.a(x) * 2; };
F4.prototype.c = function () { return this; };
F4.e = function () { return 5; };
keep.push(new F4(4));
function F5(x) { this.x = x; }
F5.prototype.a = function (x) { return x + 6; };
F5.prototype.b = function (x) { return this.a(x) * 2; };
F5.prototype.c = function () { return this; };
F5.e = function () { return 5; };
keep.push(new F5(5));
function F6(x) { this.x = x; }
F6.prototype.a = function (x) { return x + 7; };
F6.prototype.b = function (x) { return this.a(x) * 2; };
F6.prototype.c = function () { return this; };
F6.e = function () { return 5; };
keep.push(new F6(6));
function F7(x) { this.x = x; }
F7.prototype.a = function (x) { return x + 8; };
F7.prototype.b = function (x) { return this.a(x) * 2; };
F7.prototype.c = function () { return this; };
F7.e = function () { return 5; };
keep.push(new F7(7));
function F8(x) { this.x = x; }
F8.prototype.a = function (x) { return x + 9; };
F8.prototype.b = function (x) { return this.a(x) * 2; };
F8.prototype.c = function () { return this; };
F8.e = function () { return 5; };
keep.push(new F8(8));
function F9(x) { this.x = x; }
F9.prototype.a = function (x) { return x + 10; };
F9.prototype.b = function (x) { return this.a(x) * 2; };
F9.prototype.c = function () { return this; };
F9.e = function () { return 5; };
keep.push(new F9(9));
// Stores of `x` no longer pass by the prototype object of a function that was constructed early, while most of the others are not there yet.
Object.defineProperty(Object.getPrototypeOf(keep[3]), nameOfField, { set(value) { seen.push("set " + value); }, get() { return "got"; }, configurable: true });
function F10(x) { this.x = x; }
F10.prototype.a = function (x) { return x + 11; };
F10.prototype.b = function (x) { return this.a(x) * 2; };
F10.prototype.c = function () { return this; };
F10.e = function () { return 5; };
keep.push(new F10(10));
function F11(x) { this.x = x; }
F11.prototype.a = function (x) { return x + 12; };
F11.prototype.b = function (x) { return this.a(x) * 2; };
F11.prototype.c = function () { return this; };
F11.e = function () { return 5; };
keep.push(new F11(11));
function F12(x) { this.x = x; }
F12.prototype.a = function (x) { return x + 13; };
F12.prototype.b = function (x) { return this.a(x) * 2; };
F12.prototype.c = function () { return this; };
F12.e = function () { return 5; };
keep.push(new F12(12));
function F13(x) { this.x = x; }
F13.prototype.a = function (x) { return x + 14; };
F13.prototype.b = function (x) { return this.a(x) * 2; };
F13.prototype.c = function () { return this; };
F13.e = function () { return 5; };
keep.push(new F13(13));
function F14(x) { this.x = x; }
F14.prototype.a = function (x) { return x + 15; };
F14.prototype.b = function (x) { return this.a(x) * 2; };
F14.prototype.c = function () { return this; };
F14.e = function () { return 5; };
keep.push(new F14(14));
function F15(x) { this.x = x; }
F15.prototype.a = function (x) { return x + 16; };
F15.prototype.b = function (x) { return this.a(x) * 2; };
F15.prototype.c = function () { return this; };
F15.e = function () { return 5; };
keep.push(new F15(15));
function F16(x) { this.x = x; }
F16.prototype.a = function (x) { return x + 17; };
F16.prototype.b = function (x) { return this.a(x) * 2; };
F16.prototype.c = function () { return this; };
F16.e = function () { return 5; };
keep.push(new F16(16));
function F17(x) { this.x = x; }
F17.prototype.a = function (x) { return x + 18; };
F17.prototype.b = function (x) { return this.a(x) * 2; };
F17.prototype.c = function () { return this; };
F17.e = function () { return 5; };
keep.push(new F17(17));
function F18(x) { this.x = x; }
F18.prototype.a = function (x) { return x + 19; };
F18.prototype.b = function (x) { return this.a(x) * 2; };
F18.prototype.c = function () { return this; };
F18.e = function () { return 5; };
keep.push(new F18(18));
function F19(x) { this.x = x; }
F19.prototype.a = function (x) { return x + 20; };
F19.prototype.b = function (x) { return this.a(x) * 2; };
F19.prototype.c = function () { return this; };
F19.e = function () { return 5; };
keep.push(new F19(19));
function F20(x) { this.x = x; }
F20.prototype.a = function (x) { return x + 21; };
F20.prototype.b = function (x) { return this.a(x) * 2; };
F20.prototype.c = function () { return this; };
F20.e = function () { return 5; };
keep.push(new F20(20));
function F21(x) { this.x = x; }
F21.prototype.a = function (x) { return x + 22; };
F21.prototype.b = function (x) { return this.a(x) * 2; };
F21.prototype.c = function () { return this; };
F21.e = function () { return 5; };
keep.push(new F21(21));
function F22(x) { this.x = x; }
F22.prototype.a = function (x) { return x + 23; };
F22.prototype.b = function (x) { return this.a(x) * 2; };
F22.prototype.c = function () { return this; };
F22.e = function () { return 5; };
keep.push(new F22(22));
function F23(x) { this.x = x; }
F23.prototype.a = function (x) { return x + 24; };
F23.prototype.b = function (x) { return this.a(x) * 2; };
F23.prototype.c = function () { return this; };
F23.e = function () { return 5; };
keep.push(new F23(23));
function F24(x) { this.x = x; }
F24.prototype.a = function (x) { return x + 25; };
F24.prototype.b = function (x) { return this.a(x) * 2; };
F24.prototype.c = function () { return this; };
F24.e = function () { return 5; };
keep.push(new F24(24));
Object.setPrototypeOf(Object.getPrototypeOf(keep[5]), Object.defineProperty({}, nameOfField, { set(value) { seen.push("above " + value); }, get() { return "above"; } }));
function F25(x) { this.x = x; }
F25.prototype.a = function (x) { return x + 26; };
F25.prototype.b = function (x) { return this.a(x) * 2; };
F25.prototype.c = function () { return this; };
F25.e = function () { return 5; };
keep.push(new F25(25));
function F26(x) { this.x = x; }
F26.prototype.a = function (x) { return x + 27; };
F26.prototype.b = function (x) { return this.a(x) * 2; };
F26.prototype.c = function () { return this; };
F26.e = function () { return 5; };
keep.push(new F26(26));
function F27(x) { this.x = x; }
F27.prototype.a = function (x) { return x + 28; };
F27.prototype.b = function (x) { return this.a(x) * 2; };
F27.prototype.c = function () { return this; };
F27.e = function () { return 5; };
keep.push(new F27(27));
function F28(x) { this.x = x; }
F28.prototype.a = function (x) { return x + 29; };
F28.prototype.b = function (x) { return this.a(x) * 2; };
F28.prototype.c = function () { return this; };
F28.e = function () { return 5; };
keep.push(new F28(28));
function F29(x) { this.x = x; }
F29.prototype.a = function (x) { return x + 30; };
F29.prototype.b = function (x) { return this.a(x) * 2; };
F29.prototype.c = function () { return this; };
F29.e = function () { return 5; };
keep.push(new F29(29));
function F30(x) { this.x = x; }
F30.prototype.a = function (x) { return x + 31; };
F30.prototype.b = function (x) { return this.a(x) * 2; };
F30.prototype.c = function () { return this; };
F30.e = function () { return 5; };
keep.push(new F30(30));
function F31(x) { this.x = x; }
F31.prototype.a = function (x) { return x + 32; };
F31.prototype.b = function (x) { return this.a(x) * 2; };
F31.prototype.c = function () { return this; };
F31.e = function () { return 5; };
keep.push(new F31(31));
function F32(x) { this.x = x; }
F32.prototype.a = function (x) { return x + 33; };
F32.prototype.b = function (x) { return this.a(x) * 2; };
F32.prototype.c = function () { return this; };
F32.e = function () { return 5; };
keep.push(new F32(32));
function F33(x) { this.x = x; }
F33.prototype.a = function (x) { return x + 34; };
F33.prototype.b = function (x) { return this.a(x) * 2; };
F33.prototype.c = function () { return this; };
F33.e = function () { return 5; };
keep.push(new F33(33));
function F34(x) { this.x = x; }
F34.prototype.a = function (x) { return x + 35; };
F34.prototype.b = function (x) { return this.a(x) * 2; };
F34.prototype.c = function () { return this; };
F34.e = function () { return 5; };
keep.push(new F34(34));
function F35(x) { this.x = x; }
F35.prototype.a = function (x) { return x + 36; };
F35.prototype.b = function (x) { return this.a(x) * 2; };
F35.prototype.c = function () { return this; };
F35.e = function () { return 5; };
keep.push(new F35(35));
function F36(x) { this.x = x; }
F36.prototype.a = function (x) { return x + 37; };
F36.prototype.b = function (x) { return this.a(x) * 2; };
F36.prototype.c = function () { return this; };
F36.e = function () { return 5; };
keep.push(new F36(36));
function F37(x) { this.x = x; }
F37.prototype.a = function (x) { return x + 38; };
F37.prototype.b = function (x) { return this.a(x) * 2; };
F37.prototype.c = function () { return this; };
F37.e = function () { return 5; };
keep.push(new F37(37));
function F38(x) { this.x = x; }
F38.prototype.a = function (x) { return x + 39; };
F38.prototype.b = function (x) { return this.a(x) * 2; };
F38.prototype.c = function () { return this; };
F38.e = function () { return 5; };
keep.push(new F38(38));
function F39(x) { this.x = x; }
F39.prototype.a = function (x) { return x + 40; };
F39.prototype.b = function (x) { return this.a(x) * 2; };
F39.prototype.c = function () { return this; };
F39.e = function () { return 5; };
keep.push(new F39(39));
function again(round) {
  keep.push(new F3(round + 3));
  keep.push(new F5(round + 5));
  keep.push(new F10(round + 10));
  keep.push(new F11(round + 11));
  keep.push(new F25(round + 25));
  keep.push(new F26(round + 26));
  keep.push(new F39(round + 39));
  keep.push(new F0(round + 0));
}
again(100);
again(200);
again(300);
console.log(seen.join(", "));
console.log(keep.map(made => Object.keys(made).join("") + ":" + made.x + ":" + made.b(1)).join(" "));
