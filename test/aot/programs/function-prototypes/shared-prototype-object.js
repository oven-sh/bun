const out = [];
function count(name, test) { let yes = 0; for (let i = 0; i < 20000; i++) if (test()) yes++; out.push(name + " " + yes); }

function A1() { this.x = 1; } function B1() { this.y = 2; }
const shared1 = { hello() { return "hi"; } };
A1.prototype = shared1; B1.prototype = shared1;
let a1 = new A1(), b1 = new B1();
function a1IsB1() { return a1 instanceof B1; } function b1IsA1() { return b1 instanceof A1; }

function A2() { this.x = 1; } function B2() { this.y = 2; }
const shared2 = { hello() { return "hi"; } };
A2.prototype = shared2; B2.prototype = shared2;
let b2 = new B2(), a2 = new A2();
function a2IsB2() { return a2 instanceof B2; } function b2IsA2() { return b2 instanceof A2; }

function A3() { this.x = 1; } function B3() { this.y = 2; }
B3.prototype = A3.prototype;
let a3 = new A3();
function a3IsB3() { return a3 instanceof B3; }

function jQuery(s) { return new jQuery.fn.init(s); }
jQuery.fn = jQuery.prototype = { constructor: jQuery };
jQuery.fn.init = function (s) { this.s = s; };
jQuery.fn.init.prototype = jQuery.fn;
let q4 = jQuery("a");
function q4IsJQuery() { return q4 instanceof jQuery; }

class C5 { constructor() { this.x = 1; } } function D5() { this.y = 2; }
D5.prototype = C5.prototype;
let c5 = new C5(), d5 = new D5();
function c5IsD5() { return c5 instanceof D5; } function d5IsC5() { return d5 instanceof C5; }

class C11 { constructor() { this.x = 1; } } function D11() { this.y = 2; }
D11.prototype = C11.prototype;
let d11 = new D11(), c11 = new C11();
function c11IsD11() { return c11 instanceof D11; } function d11IsC11() { return d11 instanceof C11; }

function B6() { this.y = 2; }
B6.prototype = Object.prototype;
let r6 = { x: 1 }, b6 = new B6();
function r6IsB6() { return r6 instanceof B6; }

function A7() { this.x = 1; } function B7() { this.y = 2; }
const above7 = { up() { return 1; } };
A7.prototype = Object.create(above7); B7.prototype = above7;
let a7 = new A7(), b7 = new B7();
function a7IsB7() { return a7 instanceof B7; }

function A8() { this.x = 1; } function B8() { this.y = 2; }
let a8 = new A8(), b8 = new B8();
function a8IsB8() { return a8 instanceof B8; }

function A9() { this.x = 1; } function B9() { this.y = 2; }
let b9 = new B9();
A9.prototype = B9.prototype;
let a9 = new A9();
function a9IsB9() { return a9 instanceof B9; } function b9IsA9() { return b9 instanceof A9; }

function A10() { this.x = 1; } function M10() {} function B10() { this.y = 2; }
M10.prototype = A10.prototype; B10.prototype = M10.prototype;
let a10 = new A10(), b10 = new B10();
function a10IsB10() { return a10 instanceof B10; } function a10IsM10() { return a10 instanceof M10; } function b10IsA10() { return b10 instanceof A10; }

function storeFromOutside(text) {
  const v = JSON.parse(text);
  if (!v) return;
  a1 = v.a1; b1 = v.b1; a2 = v.a2; b2 = v.b2; a3 = v.a3; q4 = v.q4; c5 = v.c5; d5 = v.d5; r6 = v.r6; a7 = v.a7; a8 = v.a8; a9 = v.a9; b9 = v.b9; a10 = v.a10; b10 = v.b10; c11 = v.c11; d11 = v.d11;
}
storeFromOutside(process.argv.length > 5 ? "{}" : "null");

count("a1IsB1", a1IsB1); count("b1IsA1", b1IsA1); count("a2IsB2", a2IsB2); count("b2IsA2", b2IsA2); count("a3IsB3", a3IsB3); count("q4IsJQuery", q4IsJQuery);
count("c5IsD5", c5IsD5); count("d5IsC5", d5IsC5); count("r6IsB6", r6IsB6); count("a7IsB7", a7IsB7);
count("a8IsB8 before", a8IsB8); B8.prototype = A8.prototype; count("a8IsB8 after", a8IsB8);
count("a9IsB9", a9IsB9); count("b9IsA9", b9IsA9); count("a10IsB10", a10IsB10); count("a10IsM10", a10IsM10); count("b10IsA10", b10IsA10);
count("c11IsD11", c11IsD11); count("d11IsC11", d11IsC11);
console.log(out.join("\n"));
