// A member of a prototype object goes, or becomes another, before the first object of its constructor function is made: in each way in which it can have got there,
// on the function that is constructed late, on the one that is constructed first, and on what stands above both. Late returns `this`, so the two share their calls.
function Source1() {}
Source1.prototype.twice = function () {
  return this.x * 2;
};
function Late1(x) {
  this.x = x;
  return this;
}
function First1(x) {
  return Late1.call(this, x);
}
Late1.prototype.twice = Source1.prototype.twice;
First1.prototype.twice = Source1.prototype.twice;
console.log("assignment deleted late before", new First1(1).twice());
delete Late1.prototype.twice;
try {
  console.log("assignment deleted late late", new Late1(8).twice());
} catch (error) {
  console.log("assignment deleted late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment deleted late first", new First1(3).twice());
} catch (error) {
  console.log("assignment deleted late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source2() {}
Source2.prototype.twice = function () {
  return this.x * 2;
};
function Late2(x) {
  this.x = x;
  return this;
}
function First2(x) {
  return Late2.call(this, x);
}
Late2.prototype.twice = Source2.prototype.twice;
First2.prototype.twice = Source2.prototype.twice;
console.log("assignment deleted first before", new First2(1).twice());
delete First2.prototype.twice;
try {
  console.log("assignment deleted first late", new Late2(8).twice());
} catch (error) {
  console.log("assignment deleted first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment deleted first first", new First2(3).twice());
} catch (error) {
  console.log("assignment deleted first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source3() {}
Source3.prototype.twice = function () {
  return this.x * 2;
};
function Late3(x) {
  this.x = x;
  return this;
}
function First3(x) {
  return Late3.call(this, x);
}
function Above3() {}
Above3.prototype.twice = Source3.prototype.twice;
Object.setPrototypeOf(Late3.prototype, Above3.prototype);
Object.setPrototypeOf(First3.prototype, Above3.prototype);
console.log("assignment deleted above before", new First3(1).twice());
delete Above3.prototype.twice;
try {
  console.log("assignment deleted above late", new Late3(8).twice());
} catch (error) {
  console.log("assignment deleted above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment deleted above first", new First3(3).twice());
} catch (error) {
  console.log("assignment deleted above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source4() {}
Source4.prototype.twice = function () {
  return this.x * 2;
};
function Late4(x) {
  this.x = x;
  return this;
}
function First4(x) {
  return Late4.call(this, x);
}
Late4.prototype.twice = Source4.prototype.twice;
First4.prototype.twice = Source4.prototype.twice;
console.log("assignment stored-anew late before", new First4(1).twice());
Late4.prototype.twice = function () { return -1; };
try {
  console.log("assignment stored-anew late late", new Late4(8).twice());
} catch (error) {
  console.log("assignment stored-anew late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment stored-anew late first", new First4(3).twice());
} catch (error) {
  console.log("assignment stored-anew late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source5() {}
Source5.prototype.twice = function () {
  return this.x * 2;
};
function Late5(x) {
  this.x = x;
  return this;
}
function First5(x) {
  return Late5.call(this, x);
}
Late5.prototype.twice = Source5.prototype.twice;
First5.prototype.twice = Source5.prototype.twice;
console.log("assignment stored-anew first before", new First5(1).twice());
First5.prototype.twice = function () { return -1; };
try {
  console.log("assignment stored-anew first late", new Late5(8).twice());
} catch (error) {
  console.log("assignment stored-anew first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment stored-anew first first", new First5(3).twice());
} catch (error) {
  console.log("assignment stored-anew first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source6() {}
Source6.prototype.twice = function () {
  return this.x * 2;
};
function Late6(x) {
  this.x = x;
  return this;
}
function First6(x) {
  return Late6.call(this, x);
}
function Above6() {}
Above6.prototype.twice = Source6.prototype.twice;
Object.setPrototypeOf(Late6.prototype, Above6.prototype);
Object.setPrototypeOf(First6.prototype, Above6.prototype);
console.log("assignment stored-anew above before", new First6(1).twice());
Above6.prototype.twice = function () { return -1; };
try {
  console.log("assignment stored-anew above late", new Late6(8).twice());
} catch (error) {
  console.log("assignment stored-anew above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment stored-anew above first", new First6(3).twice());
} catch (error) {
  console.log("assignment stored-anew above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source7() {}
Source7.prototype.twice = function () {
  return this.x * 2;
};
function Late7(x) {
  this.x = x;
  return this;
}
function First7(x) {
  return Late7.call(this, x);
}
Late7.prototype.twice = Source7.prototype.twice;
First7.prototype.twice = Source7.prototype.twice;
console.log("assignment made-a-getter late before", new First7(1).twice());
Object.defineProperty(Late7.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("assignment made-a-getter late late", new Late7(8).twice());
} catch (error) {
  console.log("assignment made-a-getter late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment made-a-getter late first", new First7(3).twice());
} catch (error) {
  console.log("assignment made-a-getter late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source8() {}
Source8.prototype.twice = function () {
  return this.x * 2;
};
function Late8(x) {
  this.x = x;
  return this;
}
function First8(x) {
  return Late8.call(this, x);
}
Late8.prototype.twice = Source8.prototype.twice;
First8.prototype.twice = Source8.prototype.twice;
console.log("assignment made-a-getter first before", new First8(1).twice());
Object.defineProperty(First8.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("assignment made-a-getter first late", new Late8(8).twice());
} catch (error) {
  console.log("assignment made-a-getter first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment made-a-getter first first", new First8(3).twice());
} catch (error) {
  console.log("assignment made-a-getter first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source9() {}
Source9.prototype.twice = function () {
  return this.x * 2;
};
function Late9(x) {
  this.x = x;
  return this;
}
function First9(x) {
  return Late9.call(this, x);
}
function Above9() {}
Above9.prototype.twice = Source9.prototype.twice;
Object.setPrototypeOf(Late9.prototype, Above9.prototype);
Object.setPrototypeOf(First9.prototype, Above9.prototype);
console.log("assignment made-a-getter above before", new First9(1).twice());
Object.defineProperty(Above9.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("assignment made-a-getter above late", new Late9(8).twice());
} catch (error) {
  console.log("assignment made-a-getter above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("assignment made-a-getter above first", new First9(3).twice());
} catch (error) {
  console.log("assignment made-a-getter above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source10() {}
Source10.prototype.twice = function () {
  return this.x * 2;
};
function Late10(x) {
  this.x = x;
  return this;
}
function First10(x) {
  return Late10.call(this, x);
}
Object.defineProperty(Late10.prototype, "twice", { value: Source10.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.defineProperty(First10.prototype, "twice", { value: Source10.prototype.twice, writable: true, enumerable: true, configurable: true });
console.log("define-property deleted late before", new First10(1).twice());
delete Late10.prototype.twice;
try {
  console.log("define-property deleted late late", new Late10(8).twice());
} catch (error) {
  console.log("define-property deleted late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property deleted late first", new First10(3).twice());
} catch (error) {
  console.log("define-property deleted late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source11() {}
Source11.prototype.twice = function () {
  return this.x * 2;
};
function Late11(x) {
  this.x = x;
  return this;
}
function First11(x) {
  return Late11.call(this, x);
}
Object.defineProperty(Late11.prototype, "twice", { value: Source11.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.defineProperty(First11.prototype, "twice", { value: Source11.prototype.twice, writable: true, enumerable: true, configurable: true });
console.log("define-property deleted first before", new First11(1).twice());
delete First11.prototype.twice;
try {
  console.log("define-property deleted first late", new Late11(8).twice());
} catch (error) {
  console.log("define-property deleted first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property deleted first first", new First11(3).twice());
} catch (error) {
  console.log("define-property deleted first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source12() {}
Source12.prototype.twice = function () {
  return this.x * 2;
};
function Late12(x) {
  this.x = x;
  return this;
}
function First12(x) {
  return Late12.call(this, x);
}
function Above12() {}
Object.defineProperty(Above12.prototype, "twice", { value: Source12.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.setPrototypeOf(Late12.prototype, Above12.prototype);
Object.setPrototypeOf(First12.prototype, Above12.prototype);
console.log("define-property deleted above before", new First12(1).twice());
delete Above12.prototype.twice;
try {
  console.log("define-property deleted above late", new Late12(8).twice());
} catch (error) {
  console.log("define-property deleted above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property deleted above first", new First12(3).twice());
} catch (error) {
  console.log("define-property deleted above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source13() {}
Source13.prototype.twice = function () {
  return this.x * 2;
};
function Late13(x) {
  this.x = x;
  return this;
}
function First13(x) {
  return Late13.call(this, x);
}
Object.defineProperty(Late13.prototype, "twice", { value: Source13.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.defineProperty(First13.prototype, "twice", { value: Source13.prototype.twice, writable: true, enumerable: true, configurable: true });
console.log("define-property stored-anew late before", new First13(1).twice());
Late13.prototype.twice = function () { return -1; };
try {
  console.log("define-property stored-anew late late", new Late13(8).twice());
} catch (error) {
  console.log("define-property stored-anew late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property stored-anew late first", new First13(3).twice());
} catch (error) {
  console.log("define-property stored-anew late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source14() {}
Source14.prototype.twice = function () {
  return this.x * 2;
};
function Late14(x) {
  this.x = x;
  return this;
}
function First14(x) {
  return Late14.call(this, x);
}
Object.defineProperty(Late14.prototype, "twice", { value: Source14.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.defineProperty(First14.prototype, "twice", { value: Source14.prototype.twice, writable: true, enumerable: true, configurable: true });
console.log("define-property stored-anew first before", new First14(1).twice());
First14.prototype.twice = function () { return -1; };
try {
  console.log("define-property stored-anew first late", new Late14(8).twice());
} catch (error) {
  console.log("define-property stored-anew first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property stored-anew first first", new First14(3).twice());
} catch (error) {
  console.log("define-property stored-anew first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source15() {}
Source15.prototype.twice = function () {
  return this.x * 2;
};
function Late15(x) {
  this.x = x;
  return this;
}
function First15(x) {
  return Late15.call(this, x);
}
function Above15() {}
Object.defineProperty(Above15.prototype, "twice", { value: Source15.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.setPrototypeOf(Late15.prototype, Above15.prototype);
Object.setPrototypeOf(First15.prototype, Above15.prototype);
console.log("define-property stored-anew above before", new First15(1).twice());
Above15.prototype.twice = function () { return -1; };
try {
  console.log("define-property stored-anew above late", new Late15(8).twice());
} catch (error) {
  console.log("define-property stored-anew above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property stored-anew above first", new First15(3).twice());
} catch (error) {
  console.log("define-property stored-anew above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source16() {}
Source16.prototype.twice = function () {
  return this.x * 2;
};
function Late16(x) {
  this.x = x;
  return this;
}
function First16(x) {
  return Late16.call(this, x);
}
Object.defineProperty(Late16.prototype, "twice", { value: Source16.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.defineProperty(First16.prototype, "twice", { value: Source16.prototype.twice, writable: true, enumerable: true, configurable: true });
console.log("define-property made-a-getter late before", new First16(1).twice());
Object.defineProperty(Late16.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("define-property made-a-getter late late", new Late16(8).twice());
} catch (error) {
  console.log("define-property made-a-getter late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property made-a-getter late first", new First16(3).twice());
} catch (error) {
  console.log("define-property made-a-getter late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source17() {}
Source17.prototype.twice = function () {
  return this.x * 2;
};
function Late17(x) {
  this.x = x;
  return this;
}
function First17(x) {
  return Late17.call(this, x);
}
Object.defineProperty(Late17.prototype, "twice", { value: Source17.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.defineProperty(First17.prototype, "twice", { value: Source17.prototype.twice, writable: true, enumerable: true, configurable: true });
console.log("define-property made-a-getter first before", new First17(1).twice());
Object.defineProperty(First17.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("define-property made-a-getter first late", new Late17(8).twice());
} catch (error) {
  console.log("define-property made-a-getter first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property made-a-getter first first", new First17(3).twice());
} catch (error) {
  console.log("define-property made-a-getter first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source18() {}
Source18.prototype.twice = function () {
  return this.x * 2;
};
function Late18(x) {
  this.x = x;
  return this;
}
function First18(x) {
  return Late18.call(this, x);
}
function Above18() {}
Object.defineProperty(Above18.prototype, "twice", { value: Source18.prototype.twice, writable: true, enumerable: true, configurable: true });
Object.setPrototypeOf(Late18.prototype, Above18.prototype);
Object.setPrototypeOf(First18.prototype, Above18.prototype);
console.log("define-property made-a-getter above before", new First18(1).twice());
Object.defineProperty(Above18.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("define-property made-a-getter above late", new Late18(8).twice());
} catch (error) {
  console.log("define-property made-a-getter above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("define-property made-a-getter above first", new First18(3).twice());
} catch (error) {
  console.log("define-property made-a-getter above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source19() {}
Source19.prototype.twice = function () {
  return this.x * 2;
};
function Late19(x) {
  this.x = x;
  return this;
}
function First19(x) {
  return Late19.call(this, x);
}
for (var key19 in Source19.prototype) Late19.prototype[key19] = Source19.prototype[key19];
for (var key19 in Source19.prototype) First19.prototype[key19] = Source19.prototype[key19];
console.log("copy-loop deleted late before", new First19(1).twice());
delete Late19.prototype.twice;
try {
  console.log("copy-loop deleted late late", new Late19(8).twice());
} catch (error) {
  console.log("copy-loop deleted late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop deleted late first", new First19(3).twice());
} catch (error) {
  console.log("copy-loop deleted late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source20() {}
Source20.prototype.twice = function () {
  return this.x * 2;
};
function Late20(x) {
  this.x = x;
  return this;
}
function First20(x) {
  return Late20.call(this, x);
}
for (var key20 in Source20.prototype) Late20.prototype[key20] = Source20.prototype[key20];
for (var key20 in Source20.prototype) First20.prototype[key20] = Source20.prototype[key20];
console.log("copy-loop deleted first before", new First20(1).twice());
delete First20.prototype.twice;
try {
  console.log("copy-loop deleted first late", new Late20(8).twice());
} catch (error) {
  console.log("copy-loop deleted first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop deleted first first", new First20(3).twice());
} catch (error) {
  console.log("copy-loop deleted first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source21() {}
Source21.prototype.twice = function () {
  return this.x * 2;
};
function Late21(x) {
  this.x = x;
  return this;
}
function First21(x) {
  return Late21.call(this, x);
}
function Above21() {}
for (var key21 in Source21.prototype) Above21.prototype[key21] = Source21.prototype[key21];
Object.setPrototypeOf(Late21.prototype, Above21.prototype);
Object.setPrototypeOf(First21.prototype, Above21.prototype);
console.log("copy-loop deleted above before", new First21(1).twice());
delete Above21.prototype.twice;
try {
  console.log("copy-loop deleted above late", new Late21(8).twice());
} catch (error) {
  console.log("copy-loop deleted above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop deleted above first", new First21(3).twice());
} catch (error) {
  console.log("copy-loop deleted above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source22() {}
Source22.prototype.twice = function () {
  return this.x * 2;
};
function Late22(x) {
  this.x = x;
  return this;
}
function First22(x) {
  return Late22.call(this, x);
}
for (var key22 in Source22.prototype) Late22.prototype[key22] = Source22.prototype[key22];
for (var key22 in Source22.prototype) First22.prototype[key22] = Source22.prototype[key22];
console.log("copy-loop stored-anew late before", new First22(1).twice());
Late22.prototype.twice = function () { return -1; };
try {
  console.log("copy-loop stored-anew late late", new Late22(8).twice());
} catch (error) {
  console.log("copy-loop stored-anew late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop stored-anew late first", new First22(3).twice());
} catch (error) {
  console.log("copy-loop stored-anew late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source23() {}
Source23.prototype.twice = function () {
  return this.x * 2;
};
function Late23(x) {
  this.x = x;
  return this;
}
function First23(x) {
  return Late23.call(this, x);
}
for (var key23 in Source23.prototype) Late23.prototype[key23] = Source23.prototype[key23];
for (var key23 in Source23.prototype) First23.prototype[key23] = Source23.prototype[key23];
console.log("copy-loop stored-anew first before", new First23(1).twice());
First23.prototype.twice = function () { return -1; };
try {
  console.log("copy-loop stored-anew first late", new Late23(8).twice());
} catch (error) {
  console.log("copy-loop stored-anew first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop stored-anew first first", new First23(3).twice());
} catch (error) {
  console.log("copy-loop stored-anew first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source24() {}
Source24.prototype.twice = function () {
  return this.x * 2;
};
function Late24(x) {
  this.x = x;
  return this;
}
function First24(x) {
  return Late24.call(this, x);
}
function Above24() {}
for (var key24 in Source24.prototype) Above24.prototype[key24] = Source24.prototype[key24];
Object.setPrototypeOf(Late24.prototype, Above24.prototype);
Object.setPrototypeOf(First24.prototype, Above24.prototype);
console.log("copy-loop stored-anew above before", new First24(1).twice());
Above24.prototype.twice = function () { return -1; };
try {
  console.log("copy-loop stored-anew above late", new Late24(8).twice());
} catch (error) {
  console.log("copy-loop stored-anew above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop stored-anew above first", new First24(3).twice());
} catch (error) {
  console.log("copy-loop stored-anew above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source25() {}
Source25.prototype.twice = function () {
  return this.x * 2;
};
function Late25(x) {
  this.x = x;
  return this;
}
function First25(x) {
  return Late25.call(this, x);
}
for (var key25 in Source25.prototype) Late25.prototype[key25] = Source25.prototype[key25];
for (var key25 in Source25.prototype) First25.prototype[key25] = Source25.prototype[key25];
console.log("copy-loop made-a-getter late before", new First25(1).twice());
Object.defineProperty(Late25.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("copy-loop made-a-getter late late", new Late25(8).twice());
} catch (error) {
  console.log("copy-loop made-a-getter late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop made-a-getter late first", new First25(3).twice());
} catch (error) {
  console.log("copy-loop made-a-getter late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source26() {}
Source26.prototype.twice = function () {
  return this.x * 2;
};
function Late26(x) {
  this.x = x;
  return this;
}
function First26(x) {
  return Late26.call(this, x);
}
for (var key26 in Source26.prototype) Late26.prototype[key26] = Source26.prototype[key26];
for (var key26 in Source26.prototype) First26.prototype[key26] = Source26.prototype[key26];
console.log("copy-loop made-a-getter first before", new First26(1).twice());
Object.defineProperty(First26.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("copy-loop made-a-getter first late", new Late26(8).twice());
} catch (error) {
  console.log("copy-loop made-a-getter first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop made-a-getter first first", new First26(3).twice());
} catch (error) {
  console.log("copy-loop made-a-getter first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source27() {}
Source27.prototype.twice = function () {
  return this.x * 2;
};
function Late27(x) {
  this.x = x;
  return this;
}
function First27(x) {
  return Late27.call(this, x);
}
function Above27() {}
for (var key27 in Source27.prototype) Above27.prototype[key27] = Source27.prototype[key27];
Object.setPrototypeOf(Late27.prototype, Above27.prototype);
Object.setPrototypeOf(First27.prototype, Above27.prototype);
console.log("copy-loop made-a-getter above before", new First27(1).twice());
Object.defineProperty(Above27.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("copy-loop made-a-getter above late", new Late27(8).twice());
} catch (error) {
  console.log("copy-loop made-a-getter above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("copy-loop made-a-getter above first", new First27(3).twice());
} catch (error) {
  console.log("copy-loop made-a-getter above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source28() {}
Source28.prototype.twice = function () {
  return this.x * 2;
};
function Late28(x) {
  this.x = x;
  return this;
}
function First28(x) {
  return Late28.call(this, x);
}
Object.assign(Late28.prototype, Source28.prototype);
Object.assign(First28.prototype, Source28.prototype);
console.log("object-assign deleted late before", new First28(1).twice());
delete Late28.prototype.twice;
try {
  console.log("object-assign deleted late late", new Late28(8).twice());
} catch (error) {
  console.log("object-assign deleted late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign deleted late first", new First28(3).twice());
} catch (error) {
  console.log("object-assign deleted late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source29() {}
Source29.prototype.twice = function () {
  return this.x * 2;
};
function Late29(x) {
  this.x = x;
  return this;
}
function First29(x) {
  return Late29.call(this, x);
}
Object.assign(Late29.prototype, Source29.prototype);
Object.assign(First29.prototype, Source29.prototype);
console.log("object-assign deleted first before", new First29(1).twice());
delete First29.prototype.twice;
try {
  console.log("object-assign deleted first late", new Late29(8).twice());
} catch (error) {
  console.log("object-assign deleted first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign deleted first first", new First29(3).twice());
} catch (error) {
  console.log("object-assign deleted first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source30() {}
Source30.prototype.twice = function () {
  return this.x * 2;
};
function Late30(x) {
  this.x = x;
  return this;
}
function First30(x) {
  return Late30.call(this, x);
}
function Above30() {}
Object.assign(Above30.prototype, Source30.prototype);
Object.setPrototypeOf(Late30.prototype, Above30.prototype);
Object.setPrototypeOf(First30.prototype, Above30.prototype);
console.log("object-assign deleted above before", new First30(1).twice());
delete Above30.prototype.twice;
try {
  console.log("object-assign deleted above late", new Late30(8).twice());
} catch (error) {
  console.log("object-assign deleted above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign deleted above first", new First30(3).twice());
} catch (error) {
  console.log("object-assign deleted above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source31() {}
Source31.prototype.twice = function () {
  return this.x * 2;
};
function Late31(x) {
  this.x = x;
  return this;
}
function First31(x) {
  return Late31.call(this, x);
}
Object.assign(Late31.prototype, Source31.prototype);
Object.assign(First31.prototype, Source31.prototype);
console.log("object-assign stored-anew late before", new First31(1).twice());
Late31.prototype.twice = function () { return -1; };
try {
  console.log("object-assign stored-anew late late", new Late31(8).twice());
} catch (error) {
  console.log("object-assign stored-anew late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign stored-anew late first", new First31(3).twice());
} catch (error) {
  console.log("object-assign stored-anew late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source32() {}
Source32.prototype.twice = function () {
  return this.x * 2;
};
function Late32(x) {
  this.x = x;
  return this;
}
function First32(x) {
  return Late32.call(this, x);
}
Object.assign(Late32.prototype, Source32.prototype);
Object.assign(First32.prototype, Source32.prototype);
console.log("object-assign stored-anew first before", new First32(1).twice());
First32.prototype.twice = function () { return -1; };
try {
  console.log("object-assign stored-anew first late", new Late32(8).twice());
} catch (error) {
  console.log("object-assign stored-anew first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign stored-anew first first", new First32(3).twice());
} catch (error) {
  console.log("object-assign stored-anew first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source33() {}
Source33.prototype.twice = function () {
  return this.x * 2;
};
function Late33(x) {
  this.x = x;
  return this;
}
function First33(x) {
  return Late33.call(this, x);
}
function Above33() {}
Object.assign(Above33.prototype, Source33.prototype);
Object.setPrototypeOf(Late33.prototype, Above33.prototype);
Object.setPrototypeOf(First33.prototype, Above33.prototype);
console.log("object-assign stored-anew above before", new First33(1).twice());
Above33.prototype.twice = function () { return -1; };
try {
  console.log("object-assign stored-anew above late", new Late33(8).twice());
} catch (error) {
  console.log("object-assign stored-anew above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign stored-anew above first", new First33(3).twice());
} catch (error) {
  console.log("object-assign stored-anew above first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source34() {}
Source34.prototype.twice = function () {
  return this.x * 2;
};
function Late34(x) {
  this.x = x;
  return this;
}
function First34(x) {
  return Late34.call(this, x);
}
Object.assign(Late34.prototype, Source34.prototype);
Object.assign(First34.prototype, Source34.prototype);
console.log("object-assign made-a-getter late before", new First34(1).twice());
Object.defineProperty(Late34.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("object-assign made-a-getter late late", new Late34(8).twice());
} catch (error) {
  console.log("object-assign made-a-getter late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign made-a-getter late first", new First34(3).twice());
} catch (error) {
  console.log("object-assign made-a-getter late first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source35() {}
Source35.prototype.twice = function () {
  return this.x * 2;
};
function Late35(x) {
  this.x = x;
  return this;
}
function First35(x) {
  return Late35.call(this, x);
}
Object.assign(Late35.prototype, Source35.prototype);
Object.assign(First35.prototype, Source35.prototype);
console.log("object-assign made-a-getter first before", new First35(1).twice());
Object.defineProperty(First35.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("object-assign made-a-getter first late", new Late35(8).twice());
} catch (error) {
  console.log("object-assign made-a-getter first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign made-a-getter first first", new First35(3).twice());
} catch (error) {
  console.log("object-assign made-a-getter first first", error instanceof TypeError ? "TypeError" : "another error");
}
function Source36() {}
Source36.prototype.twice = function () {
  return this.x * 2;
};
function Late36(x) {
  this.x = x;
  return this;
}
function First36(x) {
  return Late36.call(this, x);
}
function Above36() {}
Object.assign(Above36.prototype, Source36.prototype);
Object.setPrototypeOf(Late36.prototype, Above36.prototype);
Object.setPrototypeOf(First36.prototype, Above36.prototype);
console.log("object-assign made-a-getter above before", new First36(1).twice());
Object.defineProperty(Above36.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("object-assign made-a-getter above late", new Late36(8).twice());
} catch (error) {
  console.log("object-assign made-a-getter above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("object-assign made-a-getter above first", new First36(3).twice());
} catch (error) {
  console.log("object-assign made-a-getter above first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above37 {
}
class Late37 extends Above37 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
class First37 extends Above37 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
function make37(late, x) {
  return late ? new Late37(x) : new First37(x);
}
console.log("class deleted late before", make37(false, 1).twice());
delete Late37.prototype.twice;
try {
  console.log("class deleted late late", make37(true, 8).twice());
} catch (error) {
  console.log("class deleted late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class deleted late first", make37(false, 3).twice());
} catch (error) {
  console.log("class deleted late first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above38 {
}
class Late38 extends Above38 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
class First38 extends Above38 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
function make38(late, x) {
  return late ? new Late38(x) : new First38(x);
}
console.log("class deleted first before", make38(false, 1).twice());
delete First38.prototype.twice;
try {
  console.log("class deleted first late", make38(true, 8).twice());
} catch (error) {
  console.log("class deleted first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class deleted first first", make38(false, 3).twice());
} catch (error) {
  console.log("class deleted first first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above39 {
  twice() {
    return this.x * 2;
  }
}
class Late39 extends Above39 {
  constructor(x) {
    super();
    this.x = x;
  }
}
class First39 extends Above39 {
  constructor(x) {
    super();
    this.x = x;
  }
}
function make39(late, x) {
  return late ? new Late39(x) : new First39(x);
}
console.log("class deleted above before", make39(false, 1).twice());
delete Above39.prototype.twice;
try {
  console.log("class deleted above late", make39(true, 8).twice());
} catch (error) {
  console.log("class deleted above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class deleted above first", make39(false, 3).twice());
} catch (error) {
  console.log("class deleted above first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above40 {
}
class Late40 extends Above40 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
class First40 extends Above40 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
function make40(late, x) {
  return late ? new Late40(x) : new First40(x);
}
console.log("class stored-anew late before", make40(false, 1).twice());
Late40.prototype.twice = function () { return -1; };
try {
  console.log("class stored-anew late late", make40(true, 8).twice());
} catch (error) {
  console.log("class stored-anew late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class stored-anew late first", make40(false, 3).twice());
} catch (error) {
  console.log("class stored-anew late first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above41 {
}
class Late41 extends Above41 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
class First41 extends Above41 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
function make41(late, x) {
  return late ? new Late41(x) : new First41(x);
}
console.log("class stored-anew first before", make41(false, 1).twice());
First41.prototype.twice = function () { return -1; };
try {
  console.log("class stored-anew first late", make41(true, 8).twice());
} catch (error) {
  console.log("class stored-anew first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class stored-anew first first", make41(false, 3).twice());
} catch (error) {
  console.log("class stored-anew first first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above42 {
  twice() {
    return this.x * 2;
  }
}
class Late42 extends Above42 {
  constructor(x) {
    super();
    this.x = x;
  }
}
class First42 extends Above42 {
  constructor(x) {
    super();
    this.x = x;
  }
}
function make42(late, x) {
  return late ? new Late42(x) : new First42(x);
}
console.log("class stored-anew above before", make42(false, 1).twice());
Above42.prototype.twice = function () { return -1; };
try {
  console.log("class stored-anew above late", make42(true, 8).twice());
} catch (error) {
  console.log("class stored-anew above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class stored-anew above first", make42(false, 3).twice());
} catch (error) {
  console.log("class stored-anew above first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above43 {
}
class Late43 extends Above43 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
class First43 extends Above43 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
function make43(late, x) {
  return late ? new Late43(x) : new First43(x);
}
console.log("class made-a-getter late before", make43(false, 1).twice());
Object.defineProperty(Late43.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("class made-a-getter late late", make43(true, 8).twice());
} catch (error) {
  console.log("class made-a-getter late late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class made-a-getter late first", make43(false, 3).twice());
} catch (error) {
  console.log("class made-a-getter late first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above44 {
}
class Late44 extends Above44 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
class First44 extends Above44 {
  constructor(x) {
    super();
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
function make44(late, x) {
  return late ? new Late44(x) : new First44(x);
}
console.log("class made-a-getter first before", make44(false, 1).twice());
Object.defineProperty(First44.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("class made-a-getter first late", make44(true, 8).twice());
} catch (error) {
  console.log("class made-a-getter first late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class made-a-getter first first", make44(false, 3).twice());
} catch (error) {
  console.log("class made-a-getter first first", error instanceof TypeError ? "TypeError" : "another error");
}
class Above45 {
  twice() {
    return this.x * 2;
  }
}
class Late45 extends Above45 {
  constructor(x) {
    super();
    this.x = x;
  }
}
class First45 extends Above45 {
  constructor(x) {
    super();
    this.x = x;
  }
}
function make45(late, x) {
  return late ? new Late45(x) : new First45(x);
}
console.log("class made-a-getter above before", make45(false, 1).twice());
Object.defineProperty(Above45.prototype, "twice", { get() { return function () { return -2; }; }, configurable: true });
try {
  console.log("class made-a-getter above late", make45(true, 8).twice());
} catch (error) {
  console.log("class made-a-getter above late", error instanceof TypeError ? "TypeError" : "another error");
}
try {
  console.log("class made-a-getter above first", make45(false, 3).twice());
} catch (error) {
  console.log("class made-a-getter above first", error instanceof TypeError ? "TypeError" : "another error");
}
