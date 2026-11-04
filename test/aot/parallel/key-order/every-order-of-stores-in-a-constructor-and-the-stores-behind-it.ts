type R = { a?: number; b?: number; c?: number; d?: number };
class C { declare a?: number; declare b?: number; declare c?: number; declare d?: number; }
function f0(x: number): R { const p: R = new C(); p.a = x + 1; return p; }
function f1(x: number): R { const p: R = new C(); p.b = x + 1; return p; }
function f2(x: number): R { const p: R = new C(); p.c = x + 1; return p; }
function f3(x: number): R { const p: R = new C(); p.d = x + 1; return p; }
function f4(x: number): R { const p: R = new C(); p.a = x + 1; p.a = x + 2; return p; }
function f5(x: number): R { const p: R = new C(); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f6(x: number): R { const p: R = new C(); p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f7(x: number): R { const p: R = new C(); p.a = x + 1; p.b = x + 2; return p; }
function f8(x: number): R { const p: R = new C(); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f9(x: number): R { const p: R = new C(); p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f10(x: number): R { const p: R = new C(); p.a = x + 1; p.c = x + 2; return p; }
function f11(x: number): R { const p: R = new C(); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f12(x: number): R { const p: R = new C(); p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f13(x: number): R { const p: R = new C(); p.a = x + 1; p.d = x + 2; return p; }
function f14(x: number): R { const p: R = new C(); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f15(x: number): R { const p: R = new C(); p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f16(x: number): R { const p: R = new C(); p.b = x + 1; p.a = x + 2; return p; }
function f17(x: number): R { const p: R = new C(); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f18(x: number): R { const p: R = new C(); p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f19(x: number): R { const p: R = new C(); p.b = x + 1; p.b = x + 2; return p; }
function f20(x: number): R { const p: R = new C(); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f21(x: number): R { const p: R = new C(); p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f22(x: number): R { const p: R = new C(); p.b = x + 1; p.c = x + 2; return p; }
function f23(x: number): R { const p: R = new C(); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f24(x: number): R { const p: R = new C(); p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f25(x: number): R { const p: R = new C(); p.b = x + 1; p.d = x + 2; return p; }
function f26(x: number): R { const p: R = new C(); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f27(x: number): R { const p: R = new C(); p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f28(x: number): R { const p: R = new C(); p.c = x + 1; p.a = x + 2; return p; }
function f29(x: number): R { const p: R = new C(); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f30(x: number): R { const p: R = new C(); p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f31(x: number): R { const p: R = new C(); p.c = x + 1; p.b = x + 2; return p; }
function f32(x: number): R { const p: R = new C(); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f33(x: number): R { const p: R = new C(); p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f34(x: number): R { const p: R = new C(); p.c = x + 1; p.c = x + 2; return p; }
function f35(x: number): R { const p: R = new C(); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f36(x: number): R { const p: R = new C(); p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f37(x: number): R { const p: R = new C(); p.c = x + 1; p.d = x + 2; return p; }
function f38(x: number): R { const p: R = new C(); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f39(x: number): R { const p: R = new C(); p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f40(x: number): R { const p: R = new C(); p.d = x + 1; p.a = x + 2; return p; }
function f41(x: number): R { const p: R = new C(); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f42(x: number): R { const p: R = new C(); p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f43(x: number): R { const p: R = new C(); p.d = x + 1; p.b = x + 2; return p; }
function f44(x: number): R { const p: R = new C(); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f45(x: number): R { const p: R = new C(); p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f46(x: number): R { const p: R = new C(); p.d = x + 1; p.c = x + 2; return p; }
function f47(x: number): R { const p: R = new C(); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f48(x: number): R { const p: R = new C(); p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f49(x: number): R { const p: R = new C(); p.d = x + 1; p.d = x + 2; return p; }
function f50(x: number): R { const p: R = new C(); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f51(x: number): R { const p: R = new C(); p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f52(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; return p; }
function f53(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; return p; }
function f54(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; return p; }
function f55(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; return p; }
function f56(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f57(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f58(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f59(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f60(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f61(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f62(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f63(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f64(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f65(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f66(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f67(x: number): R { const p: R = new C(); p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f68(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f69(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f70(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f71(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f72(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f73(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f74(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f75(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f76(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f77(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f78(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f79(x: number): R { const p: R = new C(); p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f80(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f81(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f82(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f83(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f84(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f85(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f86(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f87(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f88(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f89(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f90(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f91(x: number): R { const p: R = new C(); p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f92(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f93(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f94(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f95(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f96(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f97(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f98(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f99(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f100(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f101(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f102(x: number): R { const p: R = new C(); p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f103(x: number): R { const p: R = new C(); p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f104(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; return p; }
function f105(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; return p; }
function f106(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; return p; }
function f107(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; return p; }
function f108(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f109(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f110(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f111(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f112(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f113(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f114(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f115(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f116(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f117(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f118(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f119(x: number): R { const p: R = new C(); p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f120(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f121(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f122(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f123(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f124(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f125(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f126(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f127(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f128(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f129(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f130(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f131(x: number): R { const p: R = new C(); p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f132(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f133(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f134(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f135(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f136(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f137(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f138(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f139(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f140(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f141(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f142(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f143(x: number): R { const p: R = new C(); p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f144(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f145(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f146(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f147(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f148(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f149(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f150(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f151(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f152(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f153(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f154(x: number): R { const p: R = new C(); p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f155(x: number): R { const p: R = new C(); p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f156(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; return p; }
function f157(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; return p; }
function f158(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; return p; }
function f159(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; return p; }
function f160(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f161(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f162(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f163(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f164(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f165(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f166(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f167(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f168(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f169(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f170(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f171(x: number): R { const p: R = new C(); p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f172(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f173(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f174(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f175(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f176(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f177(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f178(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f179(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f180(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f181(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f182(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f183(x: number): R { const p: R = new C(); p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f184(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f185(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f186(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f187(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f188(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f189(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f190(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f191(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f192(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f193(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f194(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f195(x: number): R { const p: R = new C(); p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f196(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f197(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f198(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f199(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f200(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f201(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f202(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f203(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f204(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f205(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f206(x: number): R { const p: R = new C(); p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f207(x: number): R { const p: R = new C(); p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f208(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; return p; }
function f209(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; return p; }
function f210(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; return p; }
function f211(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; return p; }
function f212(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f213(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f214(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f215(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f216(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f217(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f218(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f219(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f220(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f221(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f222(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f223(x: number): R { const p: R = new C(); p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f224(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f225(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f226(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f227(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f228(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f229(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f230(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f231(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f232(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f233(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f234(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f235(x: number): R { const p: R = new C(); p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f236(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f237(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f238(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f239(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f240(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f241(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f242(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f243(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f244(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f245(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f246(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f247(x: number): R { const p: R = new C(); p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f248(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f249(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f250(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f251(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f252(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f253(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f254(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f255(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f256(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f257(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f258(x: number): R { const p: R = new C(); p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f259(x: number): R { const p: R = new C(); p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f260(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; return p; }
function f261(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; return p; }
function f262(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; return p; }
function f263(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; return p; }
function f264(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f265(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f266(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f267(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f268(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f269(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f270(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f271(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f272(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f273(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f274(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f275(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f276(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f277(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f278(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f279(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f280(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f281(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f282(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f283(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f284(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f285(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f286(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f287(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f288(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f289(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f290(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f291(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f292(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f293(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f294(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f295(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f296(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f297(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f298(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f299(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f300(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f301(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f302(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f303(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f304(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f305(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f306(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f307(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f308(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f309(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f310(x: number): R { const p: R = new C(); p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f311(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f312(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; return p; }
function f313(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; return p; }
function f314(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; return p; }
function f315(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; return p; }
function f316(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f317(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f318(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f319(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f320(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f321(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f322(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f323(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f324(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f325(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f326(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f327(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f328(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f329(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f330(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f331(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f332(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f333(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f334(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f335(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f336(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f337(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f338(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f339(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f340(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f341(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f342(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f343(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f344(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f345(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f346(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f347(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f348(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f349(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f350(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f351(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f352(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f353(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f354(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f355(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f356(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f357(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f358(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f359(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f360(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f361(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f362(x: number): R { const p: R = new C(); p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f363(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f364(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; return p; }
function f365(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; return p; }
function f366(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; return p; }
function f367(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; return p; }
function f368(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f369(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f370(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f371(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f372(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f373(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f374(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f375(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f376(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f377(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f378(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f379(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f380(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f381(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f382(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f383(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f384(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f385(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f386(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f387(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f388(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f389(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f390(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f391(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f392(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f393(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f394(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f395(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f396(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f397(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f398(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f399(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f400(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f401(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f402(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f403(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f404(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f405(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f406(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f407(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f408(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f409(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f410(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f411(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f412(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f413(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f414(x: number): R { const p: R = new C(); p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f415(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f416(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; return p; }
function f417(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; return p; }
function f418(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; return p; }
function f419(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; return p; }
function f420(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f421(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f422(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f423(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f424(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f425(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f426(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f427(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f428(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f429(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f430(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f431(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f432(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f433(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f434(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f435(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f436(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f437(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f438(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f439(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f440(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f441(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f442(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f443(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f444(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f445(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f446(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f447(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f448(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f449(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f450(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f451(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f452(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f453(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f454(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f455(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f456(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f457(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f458(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f459(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f460(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f461(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f462(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f463(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f464(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f465(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f466(x: number): R { const p: R = new C(); p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f467(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f468(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; return p; }
function f469(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; return p; }
function f470(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; return p; }
function f471(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; return p; }
function f472(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f473(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f474(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f475(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f476(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f477(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f478(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f479(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f480(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f481(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f482(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f483(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f484(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f485(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f486(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f487(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f488(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f489(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f490(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f491(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f492(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f493(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f494(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f495(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f496(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f497(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f498(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f499(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f500(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f501(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f502(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f503(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f504(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f505(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f506(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f507(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f508(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f509(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f510(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f511(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f512(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f513(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f514(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f515(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f516(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f517(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f518(x: number): R { const p: R = new C(); p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f519(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f520(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; return p; }
function f521(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; return p; }
function f522(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; return p; }
function f523(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; return p; }
function f524(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f525(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f526(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f527(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f528(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f529(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f530(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f531(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f532(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f533(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f534(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f535(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f536(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f537(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f538(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f539(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f540(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f541(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f542(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f543(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f544(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f545(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f546(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f547(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f548(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f549(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f550(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f551(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f552(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f553(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f554(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f555(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f556(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f557(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f558(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f559(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f560(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f561(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f562(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f563(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f564(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f565(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f566(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f567(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f568(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f569(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f570(x: number): R { const p: R = new C(); p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f571(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f572(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; return p; }
function f573(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; return p; }
function f574(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; return p; }
function f575(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; return p; }
function f576(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f577(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f578(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f579(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f580(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f581(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f582(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f583(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f584(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f585(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f586(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f587(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f588(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f589(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f590(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f591(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f592(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f593(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f594(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f595(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f596(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f597(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f598(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f599(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f600(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f601(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f602(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f603(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f604(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f605(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f606(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f607(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f608(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f609(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f610(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f611(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f612(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f613(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f614(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f615(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f616(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f617(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f618(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f619(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f620(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f621(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f622(x: number): R { const p: R = new C(); p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f623(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f624(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; return p; }
function f625(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; return p; }
function f626(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; return p; }
function f627(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; return p; }
function f628(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f629(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f630(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f631(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f632(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f633(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f634(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f635(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f636(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f637(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f638(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f639(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f640(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f641(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f642(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f643(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f644(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f645(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f646(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f647(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f648(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f649(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f650(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f651(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f652(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f653(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f654(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f655(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f656(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f657(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f658(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f659(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f660(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f661(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f662(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f663(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f664(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f665(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f666(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f667(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f668(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f669(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f670(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f671(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f672(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f673(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f674(x: number): R { const p: R = new C(); p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f675(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f676(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; return p; }
function f677(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; return p; }
function f678(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; return p; }
function f679(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; return p; }
function f680(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f681(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f682(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f683(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f684(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f685(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f686(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f687(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f688(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f689(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f690(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f691(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f692(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f693(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f694(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f695(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f696(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f697(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f698(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f699(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f700(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f701(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f702(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f703(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f704(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f705(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f706(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f707(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f708(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f709(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f710(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f711(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f712(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f713(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f714(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f715(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f716(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f717(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f718(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f719(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f720(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f721(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f722(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f723(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f724(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f725(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f726(x: number): R { const p: R = new C(); p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f727(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f728(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; return p; }
function f729(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; return p; }
function f730(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; return p; }
function f731(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; return p; }
function f732(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f733(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f734(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f735(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f736(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f737(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f738(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f739(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f740(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f741(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f742(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f743(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f744(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f745(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f746(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f747(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f748(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f749(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f750(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f751(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f752(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f753(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f754(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f755(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f756(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f757(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f758(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f759(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f760(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f761(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f762(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f763(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f764(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f765(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f766(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f767(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f768(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f769(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f770(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f771(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f772(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f773(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f774(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f775(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f776(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f777(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f778(x: number): R { const p: R = new C(); p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f779(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f780(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; return p; }
function f781(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; return p; }
function f782(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; return p; }
function f783(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; return p; }
function f784(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f785(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f786(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f787(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f788(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f789(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f790(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f791(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f792(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f793(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f794(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f795(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f796(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f797(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f798(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f799(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f800(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f801(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f802(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f803(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f804(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f805(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f806(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f807(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f808(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f809(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f810(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f811(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f812(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f813(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f814(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f815(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f816(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f817(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f818(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f819(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f820(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f821(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f822(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f823(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f824(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f825(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f826(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f827(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f828(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f829(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f830(x: number): R { const p: R = new C(); p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f831(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f832(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; return p; }
function f833(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; return p; }
function f834(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; return p; }
function f835(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; return p; }
function f836(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f837(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f838(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f839(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f840(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f841(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f842(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f843(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f844(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f845(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f846(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f847(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f848(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f849(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f850(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f851(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f852(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f853(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f854(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f855(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f856(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f857(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f858(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f859(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f860(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f861(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f862(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f863(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f864(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f865(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f866(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f867(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f868(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f869(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f870(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f871(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f872(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f873(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f874(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f875(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f876(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f877(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f878(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f879(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f880(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f881(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f882(x: number): R { const p: R = new C(); p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f883(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f884(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; return p; }
function f885(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; return p; }
function f886(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; return p; }
function f887(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; return p; }
function f888(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f889(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f890(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f891(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f892(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f893(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f894(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f895(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f896(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f897(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f898(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f899(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f900(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f901(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f902(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f903(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f904(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f905(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f906(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f907(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f908(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f909(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f910(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f911(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f912(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f913(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f914(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f915(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f916(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f917(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f918(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f919(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f920(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f921(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f922(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f923(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f924(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f925(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f926(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f927(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f928(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f929(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f930(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f931(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f932(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f933(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f934(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f935(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f936(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; return p; }
function f937(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; return p; }
function f938(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; return p; }
function f939(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; return p; }
function f940(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f941(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f942(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f943(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f944(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f945(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f946(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f947(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f948(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f949(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f950(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f951(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f952(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f953(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f954(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f955(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f956(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f957(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f958(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f959(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f960(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f961(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f962(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f963(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f964(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f965(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f966(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f967(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f968(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f969(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f970(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f971(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f972(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f973(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f974(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f975(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f976(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f977(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f978(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f979(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f980(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f981(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f982(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f983(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f984(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f985(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f986(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f987(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f988(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; return p; }
function f989(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; return p; }
function f990(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; return p; }
function f991(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; return p; }
function f992(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f993(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f994(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f995(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f996(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f997(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f998(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f999(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1000(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1001(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f1002(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1003(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1004(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f1005(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1006(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1007(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f1008(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1009(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1010(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f1011(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1012(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1013(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f1014(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1015(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1016(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f1017(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1018(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1019(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f1020(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1021(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1022(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f1023(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1024(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1025(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f1026(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1027(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1028(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f1029(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1030(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1031(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f1032(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1033(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1034(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f1035(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1036(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1037(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f1038(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1039(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1040(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; return p; }
function f1041(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; return p; }
function f1042(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; return p; }
function f1043(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; return p; }
function f1044(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f1045(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1046(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1047(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f1048(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1049(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1050(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f1051(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1052(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1053(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f1054(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1055(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1056(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f1057(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1058(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1059(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f1060(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1061(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1062(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f1063(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1064(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1065(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f1066(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1067(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1068(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f1069(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1070(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1071(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f1072(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1073(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1074(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f1075(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1076(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1077(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f1078(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1079(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1080(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f1081(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1082(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1083(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f1084(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1085(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1086(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f1087(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1088(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1089(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f1090(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1091(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1092(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; return p; }
function f1093(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; return p; }
function f1094(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; return p; }
function f1095(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; return p; }
function f1096(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f1097(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1098(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1099(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f1100(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1101(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1102(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f1103(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1104(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1105(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f1106(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1107(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1108(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f1109(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1110(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1111(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f1112(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1113(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1114(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f1115(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1116(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1117(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f1118(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1119(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1120(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f1121(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1122(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1123(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f1124(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1125(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1126(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f1127(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1128(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1129(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f1130(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1131(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1132(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f1133(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1134(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1135(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f1136(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1137(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1138(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f1139(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1140(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1141(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f1142(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1143(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1144(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; return p; }
function f1145(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; return p; }
function f1146(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; return p; }
function f1147(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; return p; }
function f1148(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f1149(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1150(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1151(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f1152(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1153(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1154(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f1155(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1156(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1157(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f1158(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1159(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1160(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f1161(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1162(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1163(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f1164(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1165(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1166(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f1167(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1168(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1169(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f1170(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1171(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1172(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f1173(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1174(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1175(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f1176(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1177(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1178(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f1179(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1180(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1181(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f1182(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1183(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1184(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f1185(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1186(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1187(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f1188(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1189(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1190(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f1191(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1192(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1193(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f1194(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1195(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1196(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; return p; }
function f1197(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; return p; }
function f1198(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; return p; }
function f1199(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; return p; }
function f1200(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f1201(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1202(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1203(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f1204(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1205(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1206(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f1207(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1208(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1209(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f1210(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1211(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1212(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f1213(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1214(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1215(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f1216(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1217(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1218(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f1219(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1220(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1221(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f1222(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1223(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1224(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f1225(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1226(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1227(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f1228(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1229(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1230(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f1231(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1232(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1233(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f1234(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1235(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1236(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f1237(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1238(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1239(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f1240(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1241(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1242(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f1243(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1244(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1245(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f1246(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1247(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1248(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; return p; }
function f1249(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; return p; }
function f1250(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; return p; }
function f1251(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; return p; }
function f1252(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f1253(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1254(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1255(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f1256(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1257(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1258(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f1259(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1260(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1261(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f1262(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1263(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1264(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f1265(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1266(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1267(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f1268(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1269(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1270(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f1271(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1272(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1273(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f1274(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1275(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1276(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f1277(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1278(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1279(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f1280(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1281(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1282(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f1283(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1284(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1285(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f1286(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1287(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1288(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f1289(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1290(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1291(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f1292(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1293(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1294(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f1295(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1296(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1297(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f1298(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1299(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1300(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; return p; }
function f1301(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; return p; }
function f1302(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; return p; }
function f1303(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; return p; }
function f1304(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f1305(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1306(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1307(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f1308(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1309(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1310(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f1311(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1312(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1313(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f1314(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1315(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1316(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f1317(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1318(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1319(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f1320(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1321(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1322(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f1323(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1324(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1325(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f1326(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1327(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1328(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f1329(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1330(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1331(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f1332(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1333(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1334(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f1335(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1336(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1337(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f1338(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1339(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1340(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f1341(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1342(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1343(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f1344(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1345(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1346(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f1347(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1348(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1349(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f1350(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1351(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1352(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; return p; }
function f1353(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; return p; }
function f1354(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; return p; }
function f1355(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; return p; }
function f1356(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f1357(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1358(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1359(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f1360(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1361(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1362(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f1363(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1364(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1365(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f1366(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1367(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1368(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f1369(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1370(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1371(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f1372(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1373(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1374(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f1375(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1376(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1377(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f1378(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1379(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1380(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f1381(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1382(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1383(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f1384(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1385(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1386(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f1387(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1388(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1389(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f1390(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1391(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1392(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f1393(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1394(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1395(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f1396(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1397(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1398(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f1399(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1400(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1401(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f1402(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1403(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1404(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; return p; }
function f1405(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; return p; }
function f1406(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; return p; }
function f1407(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; return p; }
function f1408(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f1409(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1410(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1411(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f1412(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1413(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1414(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f1415(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1416(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1417(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f1418(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1419(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1420(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f1421(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1422(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1423(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f1424(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1425(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1426(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f1427(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1428(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1429(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f1430(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1431(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1432(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f1433(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1434(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1435(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f1436(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1437(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1438(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f1439(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1440(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1441(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f1442(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1443(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1444(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f1445(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1446(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1447(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f1448(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1449(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1450(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f1451(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1452(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1453(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f1454(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1455(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1456(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; return p; }
function f1457(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; return p; }
function f1458(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; return p; }
function f1459(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; return p; }
function f1460(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f1461(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1462(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1463(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f1464(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1465(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1466(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f1467(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1468(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1469(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f1470(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1471(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1472(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f1473(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1474(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1475(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f1476(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1477(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1478(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f1479(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1480(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1481(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f1482(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1483(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1484(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f1485(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1486(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1487(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f1488(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1489(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1490(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f1491(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1492(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1493(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f1494(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1495(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1496(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f1497(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1498(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1499(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f1500(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1501(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1502(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f1503(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1504(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1505(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f1506(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1507(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1508(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; return p; }
function f1509(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; return p; }
function f1510(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; return p; }
function f1511(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; return p; }
function f1512(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f1513(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1514(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1515(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f1516(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1517(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1518(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f1519(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1520(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1521(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f1522(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1523(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1524(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f1525(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1526(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1527(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f1528(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1529(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1530(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f1531(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1532(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1533(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f1534(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1535(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1536(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f1537(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1538(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1539(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f1540(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1541(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1542(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f1543(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1544(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1545(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f1546(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1547(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1548(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f1549(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1550(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1551(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f1552(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1553(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1554(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f1555(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1556(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1557(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f1558(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1559(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1560(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; return p; }
function f1561(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; return p; }
function f1562(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; return p; }
function f1563(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; return p; }
function f1564(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f1565(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1566(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1567(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f1568(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1569(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1570(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f1571(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1572(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1573(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f1574(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1575(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1576(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f1577(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1578(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1579(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f1580(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1581(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1582(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f1583(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1584(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1585(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f1586(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1587(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1588(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f1589(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1590(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1591(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f1592(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1593(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1594(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f1595(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1596(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1597(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f1598(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1599(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1600(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f1601(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1602(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1603(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f1604(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1605(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1606(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f1607(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1608(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1609(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f1610(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1611(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1612(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; return p; }
function f1613(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; return p; }
function f1614(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; return p; }
function f1615(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; return p; }
function f1616(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f1617(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1618(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1619(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f1620(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1621(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1622(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f1623(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1624(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1625(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f1626(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1627(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1628(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f1629(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1630(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1631(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f1632(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1633(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1634(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f1635(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1636(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1637(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f1638(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1639(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1640(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f1641(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1642(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1643(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f1644(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1645(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1646(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f1647(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1648(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1649(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f1650(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1651(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1652(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f1653(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1654(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1655(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f1656(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1657(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1658(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f1659(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1660(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1661(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f1662(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1663(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1664(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; return p; }
function f1665(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; return p; }
function f1666(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; return p; }
function f1667(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; return p; }
function f1668(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f1669(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1670(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1671(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f1672(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1673(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1674(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f1675(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1676(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1677(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f1678(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1679(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1680(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f1681(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1682(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1683(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f1684(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1685(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1686(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f1687(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1688(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1689(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f1690(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1691(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1692(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f1693(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1694(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1695(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f1696(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1697(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1698(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f1699(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1700(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1701(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f1702(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1703(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1704(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f1705(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1706(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1707(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f1708(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1709(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1710(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f1711(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1712(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1713(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f1714(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1715(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1716(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; return p; }
function f1717(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; return p; }
function f1718(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; return p; }
function f1719(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; return p; }
function f1720(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f1721(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1722(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1723(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f1724(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1725(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1726(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f1727(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1728(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1729(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f1730(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1731(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1732(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f1733(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1734(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1735(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f1736(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1737(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1738(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f1739(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1740(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1741(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f1742(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1743(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1744(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f1745(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1746(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1747(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f1748(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1749(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1750(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f1751(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1752(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1753(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f1754(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1755(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1756(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f1757(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1758(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1759(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f1760(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1761(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1762(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f1763(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1764(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1765(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f1766(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1767(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1768(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; return p; }
function f1769(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; return p; }
function f1770(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; return p; }
function f1771(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; return p; }
function f1772(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f1773(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1774(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1775(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f1776(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1777(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1778(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f1779(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1780(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1781(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f1782(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1783(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1784(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f1785(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1786(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1787(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f1788(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1789(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1790(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f1791(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1792(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1793(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f1794(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1795(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1796(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f1797(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1798(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1799(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f1800(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1801(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1802(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f1803(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1804(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1805(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f1806(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1807(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1808(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f1809(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1810(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1811(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f1812(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1813(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1814(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f1815(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1816(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1817(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f1818(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1819(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1820(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; return p; }
function f1821(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; return p; }
function f1822(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; return p; }
function f1823(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; return p; }
function f1824(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f1825(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1826(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1827(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f1828(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1829(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1830(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f1831(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1832(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1833(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f1834(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1835(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1836(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f1837(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1838(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1839(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f1840(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1841(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1842(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f1843(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1844(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1845(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f1846(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1847(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1848(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f1849(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1850(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1851(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f1852(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1853(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1854(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f1855(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1856(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1857(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f1858(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1859(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1860(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f1861(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1862(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1863(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f1864(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1865(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1866(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f1867(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1868(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1869(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f1870(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1871(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1872(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; return p; }
function f1873(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; return p; }
function f1874(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; return p; }
function f1875(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; return p; }
function f1876(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f1877(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1878(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1879(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f1880(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1881(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1882(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f1883(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1884(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1885(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f1886(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1887(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1888(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f1889(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1890(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1891(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f1892(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1893(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1894(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f1895(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1896(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1897(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f1898(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1899(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1900(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f1901(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1902(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1903(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f1904(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1905(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1906(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f1907(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1908(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1909(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f1910(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1911(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1912(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f1913(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1914(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1915(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f1916(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1917(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1918(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f1919(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1920(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1921(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f1922(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1923(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1924(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; return p; }
function f1925(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; return p; }
function f1926(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; return p; }
function f1927(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; return p; }
function f1928(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f1929(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1930(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1931(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f1932(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1933(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1934(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f1935(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1936(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1937(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f1938(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1939(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1940(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f1941(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1942(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1943(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f1944(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1945(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1946(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f1947(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1948(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f1949(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f1950(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1951(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f1952(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f1953(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1954(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f1955(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f1956(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1957(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f1958(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f1959(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1960(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f1961(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f1962(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1963(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f1964(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f1965(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1966(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f1967(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f1968(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1969(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f1970(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f1971(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1972(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f1973(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f1974(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1975(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f1976(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; return p; }
function f1977(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; return p; }
function f1978(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; return p; }
function f1979(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; return p; }
function f1980(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f1981(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1982(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f1983(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f1984(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1985(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f1986(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f1987(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1988(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f1989(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f1990(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1991(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f1992(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f1993(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1994(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f1995(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f1996(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1997(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f1998(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f1999(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2000(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2001(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f2002(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2003(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2004(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f2005(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2006(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2007(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f2008(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2009(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2010(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f2011(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2012(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2013(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f2014(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2015(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2016(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f2017(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2018(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2019(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f2020(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2021(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2022(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f2023(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2024(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2025(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f2026(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2027(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2028(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; return p; }
function f2029(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; return p; }
function f2030(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; return p; }
function f2031(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; return p; }
function f2032(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f2033(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2034(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2035(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f2036(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2037(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2038(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f2039(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2040(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2041(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f2042(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2043(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2044(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f2045(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2046(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2047(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f2048(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2049(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2050(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f2051(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2052(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2053(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f2054(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2055(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2056(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f2057(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2058(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2059(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f2060(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2061(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2062(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f2063(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2064(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2065(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f2066(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2067(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2068(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f2069(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2070(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2071(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f2072(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2073(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2074(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f2075(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2076(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2077(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f2078(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2079(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2080(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; return p; }
function f2081(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; return p; }
function f2082(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; return p; }
function f2083(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; return p; }
function f2084(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f2085(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2086(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2087(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f2088(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2089(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2090(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f2091(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2092(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2093(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f2094(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2095(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2096(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f2097(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2098(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2099(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f2100(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2101(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2102(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f2103(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2104(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2105(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f2106(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2107(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2108(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f2109(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2110(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2111(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f2112(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2113(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2114(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f2115(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2116(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2117(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f2118(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2119(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2120(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f2121(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2122(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2123(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f2124(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2125(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2126(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f2127(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2128(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2129(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f2130(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2131(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2132(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; return p; }
function f2133(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; return p; }
function f2134(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; return p; }
function f2135(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; return p; }
function f2136(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f2137(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2138(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2139(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f2140(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2141(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2142(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f2143(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2144(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2145(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f2146(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2147(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2148(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f2149(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2150(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2151(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f2152(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2153(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2154(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f2155(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2156(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2157(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f2158(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2159(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2160(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f2161(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2162(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2163(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f2164(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2165(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2166(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f2167(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2168(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2169(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f2170(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2171(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2172(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f2173(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2174(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2175(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f2176(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2177(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2178(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f2179(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2180(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2181(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f2182(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2183(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2184(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; return p; }
function f2185(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; return p; }
function f2186(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; return p; }
function f2187(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; return p; }
function f2188(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f2189(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2190(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2191(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f2192(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2193(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2194(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f2195(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2196(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2197(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f2198(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2199(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2200(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f2201(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2202(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2203(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f2204(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2205(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2206(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f2207(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2208(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2209(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f2210(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2211(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2212(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f2213(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2214(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2215(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f2216(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2217(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2218(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f2219(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2220(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2221(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f2222(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2223(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2224(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f2225(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2226(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2227(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f2228(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2229(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2230(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f2231(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2232(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2233(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f2234(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2235(x: number): R { const p: R = new C(); p.a = x; p.b = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2236(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; return p; }
function f2237(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; return p; }
function f2238(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; return p; }
function f2239(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; return p; }
function f2240(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f2241(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2242(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2243(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f2244(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2245(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2246(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f2247(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2248(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2249(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f2250(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2251(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2252(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f2253(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2254(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2255(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f2256(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2257(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2258(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f2259(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2260(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2261(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f2262(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2263(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2264(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f2265(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2266(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2267(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f2268(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2269(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2270(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f2271(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2272(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2273(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f2274(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2275(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2276(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f2277(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2278(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2279(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f2280(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2281(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2282(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f2283(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2284(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2285(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f2286(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2287(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2288(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; return p; }
function f2289(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; return p; }
function f2290(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; return p; }
function f2291(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; return p; }
function f2292(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f2293(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2294(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2295(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f2296(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2297(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2298(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f2299(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2300(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2301(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f2302(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2303(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2304(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f2305(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2306(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2307(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f2308(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2309(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2310(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f2311(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2312(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2313(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f2314(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2315(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2316(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f2317(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2318(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2319(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f2320(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2321(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2322(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f2323(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2324(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2325(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f2326(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2327(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2328(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f2329(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2330(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2331(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f2332(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2333(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2334(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f2335(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2336(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2337(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f2338(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2339(x: number): R { const p: R = new C(); p.a = x; p.c = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2340(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; return p; }
function f2341(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; return p; }
function f2342(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; return p; }
function f2343(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; return p; }
function f2344(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f2345(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2346(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2347(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f2348(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2349(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2350(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f2351(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2352(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2353(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f2354(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2355(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2356(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f2357(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2358(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2359(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f2360(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2361(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2362(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f2363(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2364(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2365(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f2366(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2367(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2368(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f2369(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2370(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2371(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f2372(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2373(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2374(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f2375(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2376(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2377(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f2378(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2379(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2380(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f2381(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2382(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2383(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f2384(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2385(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2386(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f2387(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2388(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2389(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f2390(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2391(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2392(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; return p; }
function f2393(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; return p; }
function f2394(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; return p; }
function f2395(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; return p; }
function f2396(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f2397(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2398(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2399(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f2400(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2401(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2402(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f2403(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2404(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2405(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f2406(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2407(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2408(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f2409(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2410(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2411(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f2412(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2413(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2414(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f2415(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2416(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2417(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f2418(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2419(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2420(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f2421(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2422(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2423(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f2424(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2425(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2426(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f2427(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2428(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2429(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f2430(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2431(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2432(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f2433(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2434(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2435(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f2436(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2437(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2438(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f2439(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2440(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2441(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f2442(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2443(x: number): R { const p: R = new C(); p.a = x; p.d = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2444(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; return p; }
function f2445(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; return p; }
function f2446(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; return p; }
function f2447(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; return p; }
function f2448(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f2449(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2450(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2451(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f2452(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2453(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2454(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f2455(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2456(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2457(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f2458(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2459(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2460(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f2461(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2462(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2463(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f2464(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2465(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2466(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f2467(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2468(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2469(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f2470(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2471(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2472(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f2473(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2474(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2475(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f2476(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2477(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2478(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f2479(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2480(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2481(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f2482(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2483(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2484(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f2485(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2486(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2487(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f2488(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2489(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2490(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f2491(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2492(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2493(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f2494(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2495(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.c = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2496(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; return p; }
function f2497(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; return p; }
function f2498(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; return p; }
function f2499(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; return p; }
function f2500(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f2501(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2502(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2503(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f2504(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2505(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2506(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f2507(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2508(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2509(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f2510(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2511(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2512(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f2513(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2514(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2515(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f2516(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2517(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2518(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f2519(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2520(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2521(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f2522(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2523(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2524(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f2525(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2526(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2527(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f2528(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2529(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2530(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f2531(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2532(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2533(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f2534(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2535(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2536(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f2537(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2538(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2539(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f2540(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2541(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2542(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f2543(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2544(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2545(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f2546(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2547(x: number): R { const p: R = new C(); p.b = x; p.a = x; p.d = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2548(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; return p; }
function f2549(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; return p; }
function f2550(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; return p; }
function f2551(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; return p; }
function f2552(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f2553(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2554(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2555(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f2556(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2557(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2558(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f2559(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2560(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2561(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f2562(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2563(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2564(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f2565(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2566(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2567(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f2568(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2569(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2570(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f2571(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2572(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2573(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f2574(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2575(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2576(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f2577(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2578(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2579(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f2580(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2581(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2582(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f2583(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2584(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2585(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f2586(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2587(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2588(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f2589(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2590(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2591(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f2592(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2593(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2594(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f2595(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2596(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2597(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f2598(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2599(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2600(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; return p; }
function f2601(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; return p; }
function f2602(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; return p; }
function f2603(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; return p; }
function f2604(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f2605(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2606(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2607(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f2608(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2609(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2610(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f2611(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2612(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2613(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f2614(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2615(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2616(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f2617(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2618(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2619(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f2620(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2621(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2622(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f2623(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2624(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2625(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f2626(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2627(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2628(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f2629(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2630(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2631(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f2632(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2633(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2634(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f2635(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2636(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2637(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f2638(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2639(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2640(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f2641(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2642(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2643(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f2644(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2645(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2646(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f2647(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2648(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2649(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f2650(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2651(x: number): R { const p: R = new C(); p.b = x; p.c = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2652(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; return p; }
function f2653(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; return p; }
function f2654(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; return p; }
function f2655(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; return p; }
function f2656(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f2657(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2658(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2659(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f2660(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2661(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2662(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f2663(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2664(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2665(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f2666(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2667(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2668(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f2669(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2670(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2671(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f2672(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2673(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2674(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f2675(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2676(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2677(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f2678(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2679(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2680(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f2681(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2682(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2683(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f2684(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2685(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2686(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f2687(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2688(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2689(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f2690(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2691(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2692(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f2693(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2694(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2695(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f2696(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2697(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2698(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f2699(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2700(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2701(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f2702(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2703(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2704(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; return p; }
function f2705(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; return p; }
function f2706(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; return p; }
function f2707(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; return p; }
function f2708(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f2709(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2710(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2711(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f2712(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2713(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2714(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f2715(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2716(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2717(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f2718(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2719(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2720(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f2721(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2722(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2723(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f2724(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2725(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2726(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f2727(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2728(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2729(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f2730(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2731(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2732(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f2733(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2734(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2735(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f2736(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2737(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2738(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f2739(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2740(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2741(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f2742(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2743(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2744(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f2745(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2746(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2747(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f2748(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2749(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2750(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f2751(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2752(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2753(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f2754(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2755(x: number): R { const p: R = new C(); p.b = x; p.d = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2756(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; return p; }
function f2757(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; return p; }
function f2758(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; return p; }
function f2759(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; return p; }
function f2760(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f2761(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2762(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2763(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f2764(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2765(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2766(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f2767(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2768(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2769(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f2770(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2771(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2772(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f2773(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2774(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2775(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f2776(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2777(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2778(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f2779(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2780(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2781(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f2782(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2783(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2784(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f2785(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2786(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2787(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f2788(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2789(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2790(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f2791(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2792(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2793(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f2794(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2795(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2796(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f2797(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2798(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2799(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f2800(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2801(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2802(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f2803(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2804(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2805(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f2806(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2807(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.b = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2808(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; return p; }
function f2809(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; return p; }
function f2810(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; return p; }
function f2811(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; return p; }
function f2812(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f2813(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2814(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2815(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f2816(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2817(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2818(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f2819(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2820(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2821(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f2822(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2823(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2824(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f2825(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2826(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2827(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f2828(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2829(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2830(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f2831(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2832(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2833(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f2834(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2835(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2836(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f2837(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2838(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2839(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f2840(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2841(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2842(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f2843(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2844(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2845(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f2846(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2847(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2848(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f2849(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2850(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2851(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f2852(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2853(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2854(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f2855(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2856(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2857(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f2858(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2859(x: number): R { const p: R = new C(); p.c = x; p.a = x; p.d = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2860(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; return p; }
function f2861(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; return p; }
function f2862(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; return p; }
function f2863(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; return p; }
function f2864(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; p.a = x + 2; return p; }
function f2865(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2866(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2867(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; p.b = x + 2; return p; }
function f2868(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2869(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2870(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; p.c = x + 2; return p; }
function f2871(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2872(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2873(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; p.d = x + 2; return p; }
function f2874(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2875(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2876(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; p.a = x + 2; return p; }
function f2877(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2878(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2879(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; p.b = x + 2; return p; }
function f2880(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2881(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2882(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; p.c = x + 2; return p; }
function f2883(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2884(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2885(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; p.d = x + 2; return p; }
function f2886(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2887(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2888(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; p.a = x + 2; return p; }
function f2889(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2890(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2891(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; p.b = x + 2; return p; }
function f2892(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2893(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2894(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; p.c = x + 2; return p; }
function f2895(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2896(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2897(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; p.d = x + 2; return p; }
function f2898(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2899(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2900(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; p.a = x + 2; return p; }
function f2901(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2902(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2903(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; p.b = x + 2; return p; }
function f2904(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2905(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2906(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; p.c = x + 2; return p; }
function f2907(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2908(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2909(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; p.d = x + 2; return p; }
function f2910(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2911(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.a = x; p.d = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2912(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; return p; }
function f2913(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; return p; }
function f2914(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; return p; }
function f2915(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; return p; }
function f2916(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f2917(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2918(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2919(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f2920(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2921(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2922(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f2923(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2924(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2925(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f2926(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2927(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2928(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f2929(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2930(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2931(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f2932(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2933(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2934(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f2935(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2936(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2937(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f2938(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2939(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2940(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f2941(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2942(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2943(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f2944(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2945(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2946(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f2947(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2948(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f2949(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f2950(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2951(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f2952(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f2953(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2954(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f2955(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f2956(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2957(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f2958(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f2959(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2960(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f2961(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f2962(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2963(x: number): R { const p: R = new C(); p.c = x; p.b = x; p.d = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f2964(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; return p; }
function f2965(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; return p; }
function f2966(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; return p; }
function f2967(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; return p; }
function f2968(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f2969(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2970(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f2971(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f2972(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2973(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f2974(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f2975(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2976(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f2977(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f2978(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2979(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f2980(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f2981(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2982(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f2983(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f2984(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2985(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f2986(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f2987(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2988(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f2989(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f2990(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2991(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f2992(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f2993(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2994(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f2995(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f2996(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2997(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f2998(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f2999(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3000(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3001(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f3002(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3003(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3004(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f3005(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3006(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3007(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f3008(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3009(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3010(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f3011(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3012(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3013(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f3014(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3015(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3016(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; return p; }
function f3017(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; return p; }
function f3018(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; return p; }
function f3019(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; return p; }
function f3020(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f3021(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3022(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3023(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f3024(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3025(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3026(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f3027(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3028(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3029(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f3030(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3031(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3032(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f3033(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3034(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3035(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f3036(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3037(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3038(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f3039(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3040(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3041(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f3042(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3043(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3044(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f3045(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3046(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3047(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f3048(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3049(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3050(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f3051(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3052(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3053(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f3054(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3055(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3056(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f3057(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3058(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3059(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f3060(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3061(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3062(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f3063(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3064(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3065(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f3066(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3067(x: number): R { const p: R = new C(); p.c = x; p.d = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3068(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; return p; }
function f3069(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; return p; }
function f3070(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; return p; }
function f3071(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; return p; }
function f3072(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f3073(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3074(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3075(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f3076(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3077(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3078(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f3079(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3080(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3081(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f3082(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3083(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3084(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f3085(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3086(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3087(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f3088(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3089(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3090(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f3091(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3092(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3093(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f3094(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3095(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3096(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f3097(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3098(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3099(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f3100(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3101(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3102(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f3103(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3104(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3105(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f3106(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3107(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3108(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f3109(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3110(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3111(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f3112(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3113(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3114(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f3115(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3116(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3117(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f3118(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3119(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.b = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3120(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; return p; }
function f3121(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; return p; }
function f3122(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; return p; }
function f3123(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; return p; }
function f3124(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f3125(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3126(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3127(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f3128(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3129(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3130(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f3131(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3132(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3133(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f3134(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3135(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3136(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f3137(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3138(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3139(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f3140(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3141(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3142(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f3143(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3144(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3145(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f3146(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3147(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3148(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f3149(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3150(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3151(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f3152(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3153(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3154(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f3155(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3156(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3157(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f3158(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3159(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3160(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f3161(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3162(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3163(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f3164(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3165(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3166(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f3167(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3168(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3169(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f3170(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3171(x: number): R { const p: R = new C(); p.d = x; p.a = x; p.c = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3172(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; return p; }
function f3173(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; return p; }
function f3174(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; return p; }
function f3175(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; return p; }
function f3176(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; p.a = x + 2; return p; }
function f3177(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3178(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3179(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; p.b = x + 2; return p; }
function f3180(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3181(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3182(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; p.c = x + 2; return p; }
function f3183(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3184(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3185(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; p.d = x + 2; return p; }
function f3186(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3187(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3188(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; p.a = x + 2; return p; }
function f3189(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3190(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3191(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; p.b = x + 2; return p; }
function f3192(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3193(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3194(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; p.c = x + 2; return p; }
function f3195(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3196(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3197(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; p.d = x + 2; return p; }
function f3198(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3199(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3200(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; p.a = x + 2; return p; }
function f3201(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3202(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3203(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; p.b = x + 2; return p; }
function f3204(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3205(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3206(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; p.c = x + 2; return p; }
function f3207(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3208(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3209(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; p.d = x + 2; return p; }
function f3210(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3211(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3212(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; p.a = x + 2; return p; }
function f3213(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3214(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3215(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; p.b = x + 2; return p; }
function f3216(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3217(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3218(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; p.c = x + 2; return p; }
function f3219(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3220(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3221(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; p.d = x + 2; return p; }
function f3222(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3223(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.a = x; p.c = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3224(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; return p; }
function f3225(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; return p; }
function f3226(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; return p; }
function f3227(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; return p; }
function f3228(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f3229(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3230(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3231(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f3232(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3233(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3234(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f3235(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3236(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3237(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f3238(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3239(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3240(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f3241(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3242(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3243(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f3244(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3245(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3246(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f3247(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3248(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3249(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f3250(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3251(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3252(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f3253(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3254(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3255(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f3256(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3257(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3258(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f3259(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3260(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3261(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f3262(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3263(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3264(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f3265(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3266(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3267(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f3268(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3269(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3270(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f3271(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3272(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3273(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f3274(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3275(x: number): R { const p: R = new C(); p.d = x; p.b = x; p.c = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3276(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; return p; }
function f3277(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; return p; }
function f3278(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; return p; }
function f3279(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; return p; }
function f3280(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; p.a = x + 2; return p; }
function f3281(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3282(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3283(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; p.b = x + 2; return p; }
function f3284(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3285(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3286(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; p.c = x + 2; return p; }
function f3287(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3288(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3289(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; p.d = x + 2; return p; }
function f3290(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3291(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3292(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; p.a = x + 2; return p; }
function f3293(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3294(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3295(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; p.b = x + 2; return p; }
function f3296(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3297(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3298(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; p.c = x + 2; return p; }
function f3299(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3300(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3301(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; p.d = x + 2; return p; }
function f3302(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3303(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3304(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; p.a = x + 2; return p; }
function f3305(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3306(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3307(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; p.b = x + 2; return p; }
function f3308(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3309(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3310(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; p.c = x + 2; return p; }
function f3311(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3312(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3313(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; p.d = x + 2; return p; }
function f3314(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3315(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3316(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; p.a = x + 2; return p; }
function f3317(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3318(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3319(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; p.b = x + 2; return p; }
function f3320(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3321(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3322(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; p.c = x + 2; return p; }
function f3323(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3324(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3325(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; p.d = x + 2; return p; }
function f3326(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3327(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.a = x; p.b = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
function f3328(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; return p; }
function f3329(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; return p; }
function f3330(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; return p; }
function f3331(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; return p; }
function f3332(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; p.a = x + 2; return p; }
function f3333(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3334(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.a = undefined; return p; }
function f3335(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; p.b = x + 2; return p; }
function f3336(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3337(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.b = undefined; return p; }
function f3338(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; p.c = x + 2; return p; }
function f3339(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3340(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.c = undefined; return p; }
function f3341(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; p.d = x + 2; return p; }
function f3342(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3343(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.a = x + 1; if (x & 1) p.d = undefined; return p; }
function f3344(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; p.a = x + 2; return p; }
function f3345(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3346(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.a = undefined; return p; }
function f3347(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; p.b = x + 2; return p; }
function f3348(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3349(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.b = undefined; return p; }
function f3350(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; p.c = x + 2; return p; }
function f3351(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3352(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.c = undefined; return p; }
function f3353(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; p.d = x + 2; return p; }
function f3354(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3355(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.b = x + 1; if (x & 1) p.d = undefined; return p; }
function f3356(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; p.a = x + 2; return p; }
function f3357(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3358(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.a = undefined; return p; }
function f3359(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; p.b = x + 2; return p; }
function f3360(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3361(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.b = undefined; return p; }
function f3362(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; p.c = x + 2; return p; }
function f3363(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3364(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.c = undefined; return p; }
function f3365(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; p.d = x + 2; return p; }
function f3366(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3367(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.c = x + 1; if (x & 1) p.d = undefined; return p; }
function f3368(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; p.a = x + 2; return p; }
function f3369(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3370(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.a = undefined; return p; }
function f3371(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; p.b = x + 2; return p; }
function f3372(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3373(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.b = undefined; return p; }
function f3374(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; p.c = x + 2; return p; }
function f3375(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3376(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.c = undefined; return p; }
function f3377(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; p.d = x + 2; return p; }
function f3378(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3379(x: number): R { const p: R = new C(); p.d = x; p.c = x; p.b = x; p.a = x; p.d = x + 1; if (x & 1) p.d = undefined; return p; }
const all = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35, f36, f37, f38, f39, f40, f41, f42, f43, f44, f45, f46, f47, f48, f49, f50, f51, f52, f53, f54, f55, f56, f57, f58, f59, f60, f61, f62, f63, f64, f65, f66, f67, f68, f69, f70, f71, f72, f73, f74, f75, f76, f77, f78, f79, f80, f81, f82, f83, f84, f85, f86, f87, f88, f89, f90, f91, f92, f93, f94, f95, f96, f97, f98, f99, f100, f101, f102, f103, f104, f105, f106, f107, f108, f109, f110, f111, f112, f113, f114, f115, f116, f117, f118, f119, f120, f121, f122, f123, f124, f125, f126, f127, f128, f129, f130, f131, f132, f133, f134, f135, f136, f137, f138, f139, f140, f141, f142, f143, f144, f145, f146, f147, f148, f149, f150, f151, f152, f153, f154, f155, f156, f157, f158, f159, f160, f161, f162, f163, f164, f165, f166, f167, f168, f169, f170, f171, f172, f173, f174, f175, f176, f177, f178, f179, f180, f181, f182, f183, f184, f185, f186, f187, f188, f189, f190, f191, f192, f193, f194, f195, f196, f197, f198, f199, f200, f201, f202, f203, f204, f205, f206, f207, f208, f209, f210, f211, f212, f213, f214, f215, f216, f217, f218, f219, f220, f221, f222, f223, f224, f225, f226, f227, f228, f229, f230, f231, f232, f233, f234, f235, f236, f237, f238, f239, f240, f241, f242, f243, f244, f245, f246, f247, f248, f249, f250, f251, f252, f253, f254, f255, f256, f257, f258, f259, f260, f261, f262, f263, f264, f265, f266, f267, f268, f269, f270, f271, f272, f273, f274, f275, f276, f277, f278, f279, f280, f281, f282, f283, f284, f285, f286, f287, f288, f289, f290, f291, f292, f293, f294, f295, f296, f297, f298, f299, f300, f301, f302, f303, f304, f305, f306, f307, f308, f309, f310, f311, f312, f313, f314, f315, f316, f317, f318, f319, f320, f321, f322, f323, f324, f325, f326, f327, f328, f329, f330, f331, f332, f333, f334, f335, f336, f337, f338, f339, f340, f341, f342, f343, f344, f345, f346, f347, f348, f349, f350, f351, f352, f353, f354, f355, f356, f357, f358, f359, f360, f361, f362, f363, f364, f365, f366, f367, f368, f369, f370, f371, f372, f373, f374, f375, f376, f377, f378, f379, f380, f381, f382, f383, f384, f385, f386, f387, f388, f389, f390, f391, f392, f393, f394, f395, f396, f397, f398, f399, f400, f401, f402, f403, f404, f405, f406, f407, f408, f409, f410, f411, f412, f413, f414, f415, f416, f417, f418, f419, f420, f421, f422, f423, f424, f425, f426, f427, f428, f429, f430, f431, f432, f433, f434, f435, f436, f437, f438, f439, f440, f441, f442, f443, f444, f445, f446, f447, f448, f449, f450, f451, f452, f453, f454, f455, f456, f457, f458, f459, f460, f461, f462, f463, f464, f465, f466, f467, f468, f469, f470, f471, f472, f473, f474, f475, f476, f477, f478, f479, f480, f481, f482, f483, f484, f485, f486, f487, f488, f489, f490, f491, f492, f493, f494, f495, f496, f497, f498, f499, f500, f501, f502, f503, f504, f505, f506, f507, f508, f509, f510, f511, f512, f513, f514, f515, f516, f517, f518, f519, f520, f521, f522, f523, f524, f525, f526, f527, f528, f529, f530, f531, f532, f533, f534, f535, f536, f537, f538, f539, f540, f541, f542, f543, f544, f545, f546, f547, f548, f549, f550, f551, f552, f553, f554, f555, f556, f557, f558, f559, f560, f561, f562, f563, f564, f565, f566, f567, f568, f569, f570, f571, f572, f573, f574, f575, f576, f577, f578, f579, f580, f581, f582, f583, f584, f585, f586, f587, f588, f589, f590, f591, f592, f593, f594, f595, f596, f597, f598, f599, f600, f601, f602, f603, f604, f605, f606, f607, f608, f609, f610, f611, f612, f613, f614, f615, f616, f617, f618, f619, f620, f621, f622, f623, f624, f625, f626, f627, f628, f629, f630, f631, f632, f633, f634, f635, f636, f637, f638, f639, f640, f641, f642, f643, f644, f645, f646, f647, f648, f649, f650, f651, f652, f653, f654, f655, f656, f657, f658, f659, f660, f661, f662, f663, f664, f665, f666, f667, f668, f669, f670, f671, f672, f673, f674, f675, f676, f677, f678, f679, f680, f681, f682, f683, f684, f685, f686, f687, f688, f689, f690, f691, f692, f693, f694, f695, f696, f697, f698, f699, f700, f701, f702, f703, f704, f705, f706, f707, f708, f709, f710, f711, f712, f713, f714, f715, f716, f717, f718, f719, f720, f721, f722, f723, f724, f725, f726, f727, f728, f729, f730, f731, f732, f733, f734, f735, f736, f737, f738, f739, f740, f741, f742, f743, f744, f745, f746, f747, f748, f749, f750, f751, f752, f753, f754, f755, f756, f757, f758, f759, f760, f761, f762, f763, f764, f765, f766, f767, f768, f769, f770, f771, f772, f773, f774, f775, f776, f777, f778, f779, f780, f781, f782, f783, f784, f785, f786, f787, f788, f789, f790, f791, f792, f793, f794, f795, f796, f797, f798, f799, f800, f801, f802, f803, f804, f805, f806, f807, f808, f809, f810, f811, f812, f813, f814, f815, f816, f817, f818, f819, f820, f821, f822, f823, f824, f825, f826, f827, f828, f829, f830, f831, f832, f833, f834, f835, f836, f837, f838, f839, f840, f841, f842, f843, f844, f845, f846, f847, f848, f849, f850, f851, f852, f853, f854, f855, f856, f857, f858, f859, f860, f861, f862, f863, f864, f865, f866, f867, f868, f869, f870, f871, f872, f873, f874, f875, f876, f877, f878, f879, f880, f881, f882, f883, f884, f885, f886, f887, f888, f889, f890, f891, f892, f893, f894, f895, f896, f897, f898, f899, f900, f901, f902, f903, f904, f905, f906, f907, f908, f909, f910, f911, f912, f913, f914, f915, f916, f917, f918, f919, f920, f921, f922, f923, f924, f925, f926, f927, f928, f929, f930, f931, f932, f933, f934, f935, f936, f937, f938, f939, f940, f941, f942, f943, f944, f945, f946, f947, f948, f949, f950, f951, f952, f953, f954, f955, f956, f957, f958, f959, f960, f961, f962, f963, f964, f965, f966, f967, f968, f969, f970, f971, f972, f973, f974, f975, f976, f977, f978, f979, f980, f981, f982, f983, f984, f985, f986, f987, f988, f989, f990, f991, f992, f993, f994, f995, f996, f997, f998, f999, f1000, f1001, f1002, f1003, f1004, f1005, f1006, f1007, f1008, f1009, f1010, f1011, f1012, f1013, f1014, f1015, f1016, f1017, f1018, f1019, f1020, f1021, f1022, f1023, f1024, f1025, f1026, f1027, f1028, f1029, f1030, f1031, f1032, f1033, f1034, f1035, f1036, f1037, f1038, f1039, f1040, f1041, f1042, f1043, f1044, f1045, f1046, f1047, f1048, f1049, f1050, f1051, f1052, f1053, f1054, f1055, f1056, f1057, f1058, f1059, f1060, f1061, f1062, f1063, f1064, f1065, f1066, f1067, f1068, f1069, f1070, f1071, f1072, f1073, f1074, f1075, f1076, f1077, f1078, f1079, f1080, f1081, f1082, f1083, f1084, f1085, f1086, f1087, f1088, f1089, f1090, f1091, f1092, f1093, f1094, f1095, f1096, f1097, f1098, f1099, f1100, f1101, f1102, f1103, f1104, f1105, f1106, f1107, f1108, f1109, f1110, f1111, f1112, f1113, f1114, f1115, f1116, f1117, f1118, f1119, f1120, f1121, f1122, f1123, f1124, f1125, f1126, f1127, f1128, f1129, f1130, f1131, f1132, f1133, f1134, f1135, f1136, f1137, f1138, f1139, f1140, f1141, f1142, f1143, f1144, f1145, f1146, f1147, f1148, f1149, f1150, f1151, f1152, f1153, f1154, f1155, f1156, f1157, f1158, f1159, f1160, f1161, f1162, f1163, f1164, f1165, f1166, f1167, f1168, f1169, f1170, f1171, f1172, f1173, f1174, f1175, f1176, f1177, f1178, f1179, f1180, f1181, f1182, f1183, f1184, f1185, f1186, f1187, f1188, f1189, f1190, f1191, f1192, f1193, f1194, f1195, f1196, f1197, f1198, f1199, f1200, f1201, f1202, f1203, f1204, f1205, f1206, f1207, f1208, f1209, f1210, f1211, f1212, f1213, f1214, f1215, f1216, f1217, f1218, f1219, f1220, f1221, f1222, f1223, f1224, f1225, f1226, f1227, f1228, f1229, f1230, f1231, f1232, f1233, f1234, f1235, f1236, f1237, f1238, f1239, f1240, f1241, f1242, f1243, f1244, f1245, f1246, f1247, f1248, f1249, f1250, f1251, f1252, f1253, f1254, f1255, f1256, f1257, f1258, f1259, f1260, f1261, f1262, f1263, f1264, f1265, f1266, f1267, f1268, f1269, f1270, f1271, f1272, f1273, f1274, f1275, f1276, f1277, f1278, f1279, f1280, f1281, f1282, f1283, f1284, f1285, f1286, f1287, f1288, f1289, f1290, f1291, f1292, f1293, f1294, f1295, f1296, f1297, f1298, f1299, f1300, f1301, f1302, f1303, f1304, f1305, f1306, f1307, f1308, f1309, f1310, f1311, f1312, f1313, f1314, f1315, f1316, f1317, f1318, f1319, f1320, f1321, f1322, f1323, f1324, f1325, f1326, f1327, f1328, f1329, f1330, f1331, f1332, f1333, f1334, f1335, f1336, f1337, f1338, f1339, f1340, f1341, f1342, f1343, f1344, f1345, f1346, f1347, f1348, f1349, f1350, f1351, f1352, f1353, f1354, f1355, f1356, f1357, f1358, f1359, f1360, f1361, f1362, f1363, f1364, f1365, f1366, f1367, f1368, f1369, f1370, f1371, f1372, f1373, f1374, f1375, f1376, f1377, f1378, f1379, f1380, f1381, f1382, f1383, f1384, f1385, f1386, f1387, f1388, f1389, f1390, f1391, f1392, f1393, f1394, f1395, f1396, f1397, f1398, f1399, f1400, f1401, f1402, f1403, f1404, f1405, f1406, f1407, f1408, f1409, f1410, f1411, f1412, f1413, f1414, f1415, f1416, f1417, f1418, f1419, f1420, f1421, f1422, f1423, f1424, f1425, f1426, f1427, f1428, f1429, f1430, f1431, f1432, f1433, f1434, f1435, f1436, f1437, f1438, f1439, f1440, f1441, f1442, f1443, f1444, f1445, f1446, f1447, f1448, f1449, f1450, f1451, f1452, f1453, f1454, f1455, f1456, f1457, f1458, f1459, f1460, f1461, f1462, f1463, f1464, f1465, f1466, f1467, f1468, f1469, f1470, f1471, f1472, f1473, f1474, f1475, f1476, f1477, f1478, f1479, f1480, f1481, f1482, f1483, f1484, f1485, f1486, f1487, f1488, f1489, f1490, f1491, f1492, f1493, f1494, f1495, f1496, f1497, f1498, f1499, f1500, f1501, f1502, f1503, f1504, f1505, f1506, f1507, f1508, f1509, f1510, f1511, f1512, f1513, f1514, f1515, f1516, f1517, f1518, f1519, f1520, f1521, f1522, f1523, f1524, f1525, f1526, f1527, f1528, f1529, f1530, f1531, f1532, f1533, f1534, f1535, f1536, f1537, f1538, f1539, f1540, f1541, f1542, f1543, f1544, f1545, f1546, f1547, f1548, f1549, f1550, f1551, f1552, f1553, f1554, f1555, f1556, f1557, f1558, f1559, f1560, f1561, f1562, f1563, f1564, f1565, f1566, f1567, f1568, f1569, f1570, f1571, f1572, f1573, f1574, f1575, f1576, f1577, f1578, f1579, f1580, f1581, f1582, f1583, f1584, f1585, f1586, f1587, f1588, f1589, f1590, f1591, f1592, f1593, f1594, f1595, f1596, f1597, f1598, f1599, f1600, f1601, f1602, f1603, f1604, f1605, f1606, f1607, f1608, f1609, f1610, f1611, f1612, f1613, f1614, f1615, f1616, f1617, f1618, f1619, f1620, f1621, f1622, f1623, f1624, f1625, f1626, f1627, f1628, f1629, f1630, f1631, f1632, f1633, f1634, f1635, f1636, f1637, f1638, f1639, f1640, f1641, f1642, f1643, f1644, f1645, f1646, f1647, f1648, f1649, f1650, f1651, f1652, f1653, f1654, f1655, f1656, f1657, f1658, f1659, f1660, f1661, f1662, f1663, f1664, f1665, f1666, f1667, f1668, f1669, f1670, f1671, f1672, f1673, f1674, f1675, f1676, f1677, f1678, f1679, f1680, f1681, f1682, f1683, f1684, f1685, f1686, f1687, f1688, f1689, f1690, f1691, f1692, f1693, f1694, f1695, f1696, f1697, f1698, f1699, f1700, f1701, f1702, f1703, f1704, f1705, f1706, f1707, f1708, f1709, f1710, f1711, f1712, f1713, f1714, f1715, f1716, f1717, f1718, f1719, f1720, f1721, f1722, f1723, f1724, f1725, f1726, f1727, f1728, f1729, f1730, f1731, f1732, f1733, f1734, f1735, f1736, f1737, f1738, f1739, f1740, f1741, f1742, f1743, f1744, f1745, f1746, f1747, f1748, f1749, f1750, f1751, f1752, f1753, f1754, f1755, f1756, f1757, f1758, f1759, f1760, f1761, f1762, f1763, f1764, f1765, f1766, f1767, f1768, f1769, f1770, f1771, f1772, f1773, f1774, f1775, f1776, f1777, f1778, f1779, f1780, f1781, f1782, f1783, f1784, f1785, f1786, f1787, f1788, f1789, f1790, f1791, f1792, f1793, f1794, f1795, f1796, f1797, f1798, f1799, f1800, f1801, f1802, f1803, f1804, f1805, f1806, f1807, f1808, f1809, f1810, f1811, f1812, f1813, f1814, f1815, f1816, f1817, f1818, f1819, f1820, f1821, f1822, f1823, f1824, f1825, f1826, f1827, f1828, f1829, f1830, f1831, f1832, f1833, f1834, f1835, f1836, f1837, f1838, f1839, f1840, f1841, f1842, f1843, f1844, f1845, f1846, f1847, f1848, f1849, f1850, f1851, f1852, f1853, f1854, f1855, f1856, f1857, f1858, f1859, f1860, f1861, f1862, f1863, f1864, f1865, f1866, f1867, f1868, f1869, f1870, f1871, f1872, f1873, f1874, f1875, f1876, f1877, f1878, f1879, f1880, f1881, f1882, f1883, f1884, f1885, f1886, f1887, f1888, f1889, f1890, f1891, f1892, f1893, f1894, f1895, f1896, f1897, f1898, f1899, f1900, f1901, f1902, f1903, f1904, f1905, f1906, f1907, f1908, f1909, f1910, f1911, f1912, f1913, f1914, f1915, f1916, f1917, f1918, f1919, f1920, f1921, f1922, f1923, f1924, f1925, f1926, f1927, f1928, f1929, f1930, f1931, f1932, f1933, f1934, f1935, f1936, f1937, f1938, f1939, f1940, f1941, f1942, f1943, f1944, f1945, f1946, f1947, f1948, f1949, f1950, f1951, f1952, f1953, f1954, f1955, f1956, f1957, f1958, f1959, f1960, f1961, f1962, f1963, f1964, f1965, f1966, f1967, f1968, f1969, f1970, f1971, f1972, f1973, f1974, f1975, f1976, f1977, f1978, f1979, f1980, f1981, f1982, f1983, f1984, f1985, f1986, f1987, f1988, f1989, f1990, f1991, f1992, f1993, f1994, f1995, f1996, f1997, f1998, f1999, f2000, f2001, f2002, f2003, f2004, f2005, f2006, f2007, f2008, f2009, f2010, f2011, f2012, f2013, f2014, f2015, f2016, f2017, f2018, f2019, f2020, f2021, f2022, f2023, f2024, f2025, f2026, f2027, f2028, f2029, f2030, f2031, f2032, f2033, f2034, f2035, f2036, f2037, f2038, f2039, f2040, f2041, f2042, f2043, f2044, f2045, f2046, f2047, f2048, f2049, f2050, f2051, f2052, f2053, f2054, f2055, f2056, f2057, f2058, f2059, f2060, f2061, f2062, f2063, f2064, f2065, f2066, f2067, f2068, f2069, f2070, f2071, f2072, f2073, f2074, f2075, f2076, f2077, f2078, f2079, f2080, f2081, f2082, f2083, f2084, f2085, f2086, f2087, f2088, f2089, f2090, f2091, f2092, f2093, f2094, f2095, f2096, f2097, f2098, f2099, f2100, f2101, f2102, f2103, f2104, f2105, f2106, f2107, f2108, f2109, f2110, f2111, f2112, f2113, f2114, f2115, f2116, f2117, f2118, f2119, f2120, f2121, f2122, f2123, f2124, f2125, f2126, f2127, f2128, f2129, f2130, f2131, f2132, f2133, f2134, f2135, f2136, f2137, f2138, f2139, f2140, f2141, f2142, f2143, f2144, f2145, f2146, f2147, f2148, f2149, f2150, f2151, f2152, f2153, f2154, f2155, f2156, f2157, f2158, f2159, f2160, f2161, f2162, f2163, f2164, f2165, f2166, f2167, f2168, f2169, f2170, f2171, f2172, f2173, f2174, f2175, f2176, f2177, f2178, f2179, f2180, f2181, f2182, f2183, f2184, f2185, f2186, f2187, f2188, f2189, f2190, f2191, f2192, f2193, f2194, f2195, f2196, f2197, f2198, f2199, f2200, f2201, f2202, f2203, f2204, f2205, f2206, f2207, f2208, f2209, f2210, f2211, f2212, f2213, f2214, f2215, f2216, f2217, f2218, f2219, f2220, f2221, f2222, f2223, f2224, f2225, f2226, f2227, f2228, f2229, f2230, f2231, f2232, f2233, f2234, f2235, f2236, f2237, f2238, f2239, f2240, f2241, f2242, f2243, f2244, f2245, f2246, f2247, f2248, f2249, f2250, f2251, f2252, f2253, f2254, f2255, f2256, f2257, f2258, f2259, f2260, f2261, f2262, f2263, f2264, f2265, f2266, f2267, f2268, f2269, f2270, f2271, f2272, f2273, f2274, f2275, f2276, f2277, f2278, f2279, f2280, f2281, f2282, f2283, f2284, f2285, f2286, f2287, f2288, f2289, f2290, f2291, f2292, f2293, f2294, f2295, f2296, f2297, f2298, f2299, f2300, f2301, f2302, f2303, f2304, f2305, f2306, f2307, f2308, f2309, f2310, f2311, f2312, f2313, f2314, f2315, f2316, f2317, f2318, f2319, f2320, f2321, f2322, f2323, f2324, f2325, f2326, f2327, f2328, f2329, f2330, f2331, f2332, f2333, f2334, f2335, f2336, f2337, f2338, f2339, f2340, f2341, f2342, f2343, f2344, f2345, f2346, f2347, f2348, f2349, f2350, f2351, f2352, f2353, f2354, f2355, f2356, f2357, f2358, f2359, f2360, f2361, f2362, f2363, f2364, f2365, f2366, f2367, f2368, f2369, f2370, f2371, f2372, f2373, f2374, f2375, f2376, f2377, f2378, f2379, f2380, f2381, f2382, f2383, f2384, f2385, f2386, f2387, f2388, f2389, f2390, f2391, f2392, f2393, f2394, f2395, f2396, f2397, f2398, f2399, f2400, f2401, f2402, f2403, f2404, f2405, f2406, f2407, f2408, f2409, f2410, f2411, f2412, f2413, f2414, f2415, f2416, f2417, f2418, f2419, f2420, f2421, f2422, f2423, f2424, f2425, f2426, f2427, f2428, f2429, f2430, f2431, f2432, f2433, f2434, f2435, f2436, f2437, f2438, f2439, f2440, f2441, f2442, f2443, f2444, f2445, f2446, f2447, f2448, f2449, f2450, f2451, f2452, f2453, f2454, f2455, f2456, f2457, f2458, f2459, f2460, f2461, f2462, f2463, f2464, f2465, f2466, f2467, f2468, f2469, f2470, f2471, f2472, f2473, f2474, f2475, f2476, f2477, f2478, f2479, f2480, f2481, f2482, f2483, f2484, f2485, f2486, f2487, f2488, f2489, f2490, f2491, f2492, f2493, f2494, f2495, f2496, f2497, f2498, f2499, f2500, f2501, f2502, f2503, f2504, f2505, f2506, f2507, f2508, f2509, f2510, f2511, f2512, f2513, f2514, f2515, f2516, f2517, f2518, f2519, f2520, f2521, f2522, f2523, f2524, f2525, f2526, f2527, f2528, f2529, f2530, f2531, f2532, f2533, f2534, f2535, f2536, f2537, f2538, f2539, f2540, f2541, f2542, f2543, f2544, f2545, f2546, f2547, f2548, f2549, f2550, f2551, f2552, f2553, f2554, f2555, f2556, f2557, f2558, f2559, f2560, f2561, f2562, f2563, f2564, f2565, f2566, f2567, f2568, f2569, f2570, f2571, f2572, f2573, f2574, f2575, f2576, f2577, f2578, f2579, f2580, f2581, f2582, f2583, f2584, f2585, f2586, f2587, f2588, f2589, f2590, f2591, f2592, f2593, f2594, f2595, f2596, f2597, f2598, f2599, f2600, f2601, f2602, f2603, f2604, f2605, f2606, f2607, f2608, f2609, f2610, f2611, f2612, f2613, f2614, f2615, f2616, f2617, f2618, f2619, f2620, f2621, f2622, f2623, f2624, f2625, f2626, f2627, f2628, f2629, f2630, f2631, f2632, f2633, f2634, f2635, f2636, f2637, f2638, f2639, f2640, f2641, f2642, f2643, f2644, f2645, f2646, f2647, f2648, f2649, f2650, f2651, f2652, f2653, f2654, f2655, f2656, f2657, f2658, f2659, f2660, f2661, f2662, f2663, f2664, f2665, f2666, f2667, f2668, f2669, f2670, f2671, f2672, f2673, f2674, f2675, f2676, f2677, f2678, f2679, f2680, f2681, f2682, f2683, f2684, f2685, f2686, f2687, f2688, f2689, f2690, f2691, f2692, f2693, f2694, f2695, f2696, f2697, f2698, f2699, f2700, f2701, f2702, f2703, f2704, f2705, f2706, f2707, f2708, f2709, f2710, f2711, f2712, f2713, f2714, f2715, f2716, f2717, f2718, f2719, f2720, f2721, f2722, f2723, f2724, f2725, f2726, f2727, f2728, f2729, f2730, f2731, f2732, f2733, f2734, f2735, f2736, f2737, f2738, f2739, f2740, f2741, f2742, f2743, f2744, f2745, f2746, f2747, f2748, f2749, f2750, f2751, f2752, f2753, f2754, f2755, f2756, f2757, f2758, f2759, f2760, f2761, f2762, f2763, f2764, f2765, f2766, f2767, f2768, f2769, f2770, f2771, f2772, f2773, f2774, f2775, f2776, f2777, f2778, f2779, f2780, f2781, f2782, f2783, f2784, f2785, f2786, f2787, f2788, f2789, f2790, f2791, f2792, f2793, f2794, f2795, f2796, f2797, f2798, f2799, f2800, f2801, f2802, f2803, f2804, f2805, f2806, f2807, f2808, f2809, f2810, f2811, f2812, f2813, f2814, f2815, f2816, f2817, f2818, f2819, f2820, f2821, f2822, f2823, f2824, f2825, f2826, f2827, f2828, f2829, f2830, f2831, f2832, f2833, f2834, f2835, f2836, f2837, f2838, f2839, f2840, f2841, f2842, f2843, f2844, f2845, f2846, f2847, f2848, f2849, f2850, f2851, f2852, f2853, f2854, f2855, f2856, f2857, f2858, f2859, f2860, f2861, f2862, f2863, f2864, f2865, f2866, f2867, f2868, f2869, f2870, f2871, f2872, f2873, f2874, f2875, f2876, f2877, f2878, f2879, f2880, f2881, f2882, f2883, f2884, f2885, f2886, f2887, f2888, f2889, f2890, f2891, f2892, f2893, f2894, f2895, f2896, f2897, f2898, f2899, f2900, f2901, f2902, f2903, f2904, f2905, f2906, f2907, f2908, f2909, f2910, f2911, f2912, f2913, f2914, f2915, f2916, f2917, f2918, f2919, f2920, f2921, f2922, f2923, f2924, f2925, f2926, f2927, f2928, f2929, f2930, f2931, f2932, f2933, f2934, f2935, f2936, f2937, f2938, f2939, f2940, f2941, f2942, f2943, f2944, f2945, f2946, f2947, f2948, f2949, f2950, f2951, f2952, f2953, f2954, f2955, f2956, f2957, f2958, f2959, f2960, f2961, f2962, f2963, f2964, f2965, f2966, f2967, f2968, f2969, f2970, f2971, f2972, f2973, f2974, f2975, f2976, f2977, f2978, f2979, f2980, f2981, f2982, f2983, f2984, f2985, f2986, f2987, f2988, f2989, f2990, f2991, f2992, f2993, f2994, f2995, f2996, f2997, f2998, f2999, f3000, f3001, f3002, f3003, f3004, f3005, f3006, f3007, f3008, f3009, f3010, f3011, f3012, f3013, f3014, f3015, f3016, f3017, f3018, f3019, f3020, f3021, f3022, f3023, f3024, f3025, f3026, f3027, f3028, f3029, f3030, f3031, f3032, f3033, f3034, f3035, f3036, f3037, f3038, f3039, f3040, f3041, f3042, f3043, f3044, f3045, f3046, f3047, f3048, f3049, f3050, f3051, f3052, f3053, f3054, f3055, f3056, f3057, f3058, f3059, f3060, f3061, f3062, f3063, f3064, f3065, f3066, f3067, f3068, f3069, f3070, f3071, f3072, f3073, f3074, f3075, f3076, f3077, f3078, f3079, f3080, f3081, f3082, f3083, f3084, f3085, f3086, f3087, f3088, f3089, f3090, f3091, f3092, f3093, f3094, f3095, f3096, f3097, f3098, f3099, f3100, f3101, f3102, f3103, f3104, f3105, f3106, f3107, f3108, f3109, f3110, f3111, f3112, f3113, f3114, f3115, f3116, f3117, f3118, f3119, f3120, f3121, f3122, f3123, f3124, f3125, f3126, f3127, f3128, f3129, f3130, f3131, f3132, f3133, f3134, f3135, f3136, f3137, f3138, f3139, f3140, f3141, f3142, f3143, f3144, f3145, f3146, f3147, f3148, f3149, f3150, f3151, f3152, f3153, f3154, f3155, f3156, f3157, f3158, f3159, f3160, f3161, f3162, f3163, f3164, f3165, f3166, f3167, f3168, f3169, f3170, f3171, f3172, f3173, f3174, f3175, f3176, f3177, f3178, f3179, f3180, f3181, f3182, f3183, f3184, f3185, f3186, f3187, f3188, f3189, f3190, f3191, f3192, f3193, f3194, f3195, f3196, f3197, f3198, f3199, f3200, f3201, f3202, f3203, f3204, f3205, f3206, f3207, f3208, f3209, f3210, f3211, f3212, f3213, f3214, f3215, f3216, f3217, f3218, f3219, f3220, f3221, f3222, f3223, f3224, f3225, f3226, f3227, f3228, f3229, f3230, f3231, f3232, f3233, f3234, f3235, f3236, f3237, f3238, f3239, f3240, f3241, f3242, f3243, f3244, f3245, f3246, f3247, f3248, f3249, f3250, f3251, f3252, f3253, f3254, f3255, f3256, f3257, f3258, f3259, f3260, f3261, f3262, f3263, f3264, f3265, f3266, f3267, f3268, f3269, f3270, f3271, f3272, f3273, f3274, f3275, f3276, f3277, f3278, f3279, f3280, f3281, f3282, f3283, f3284, f3285, f3286, f3287, f3288, f3289, f3290, f3291, f3292, f3293, f3294, f3295, f3296, f3297, f3298, f3299, f3300, f3301, f3302, f3303, f3304, f3305, f3306, f3307, f3308, f3309, f3310, f3311, f3312, f3313, f3314, f3315, f3316, f3317, f3318, f3319, f3320, f3321, f3322, f3323, f3324, f3325, f3326, f3327, f3328, f3329, f3330, f3331, f3332, f3333, f3334, f3335, f3336, f3337, f3338, f3339, f3340, f3341, f3342, f3343, f3344, f3345, f3346, f3347, f3348, f3349, f3350, f3351, f3352, f3353, f3354, f3355, f3356, f3357, f3358, f3359, f3360, f3361, f3362, f3363, f3364, f3365, f3366, f3367, f3368, f3369, f3370, f3371, f3372, f3373, f3374, f3375, f3376, f3377, f3378, f3379];
let line = ""; let count = 0;
for (const f of all) for (let x = 0; x < 2; x++) { const p = f(x); line += Object.keys(p).join("") + ":" + [p.a, p.b, p.c, p.d].join() + " "; if (++count % 24 === 0) { console.log(line); line = ""; } }
console.log(line);
