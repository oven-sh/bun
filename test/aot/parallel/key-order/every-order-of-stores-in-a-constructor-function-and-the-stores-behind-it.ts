type R = { a?: number; b?: number; c?: number; d?: number };
function F0(this: any, x: number) { }
function G0(this: any, x: number) { }
let v0: any;
function F1(this: any, x: number) { this.a = x; }
function G1(this: any, x: number) { this.a = x; }
let v1: any;
function F2(this: any, x: number) { this.b = x; }
function G2(this: any, x: number) { this.b = x; }
let v2: any;
function F3(this: any, x: number) { this.c = x; }
function G3(this: any, x: number) { this.c = x; }
let v3: any;
function F4(this: any, x: number) { this.d = x; }
function G4(this: any, x: number) { this.d = x; }
let v4: any;
function F5(this: any, x: number) { this.a = x; this.b = x; }
function G5(this: any, x: number) { this.a = x; if (x & 1) this.b = x; }
let v5: any;
function F6(this: any, x: number) { this.a = x; this.c = x; }
function G6(this: any, x: number) { this.a = x; if (x & 1) this.c = x; }
let v6: any;
function F7(this: any, x: number) { this.a = x; this.d = x; }
function G7(this: any, x: number) { this.a = x; if (x & 1) this.d = x; }
let v7: any;
function F8(this: any, x: number) { this.b = x; this.a = x; }
function G8(this: any, x: number) { this.b = x; if (x & 1) this.a = x; }
let v8: any;
function F9(this: any, x: number) { this.b = x; this.c = x; }
function G9(this: any, x: number) { this.b = x; if (x & 1) this.c = x; }
let v9: any;
function F10(this: any, x: number) { this.b = x; this.d = x; }
function G10(this: any, x: number) { this.b = x; if (x & 1) this.d = x; }
let v10: any;
function F11(this: any, x: number) { this.c = x; this.a = x; }
function G11(this: any, x: number) { this.c = x; if (x & 1) this.a = x; }
let v11: any;
function F12(this: any, x: number) { this.c = x; this.b = x; }
function G12(this: any, x: number) { this.c = x; if (x & 1) this.b = x; }
let v12: any;
function F13(this: any, x: number) { this.c = x; this.d = x; }
function G13(this: any, x: number) { this.c = x; if (x & 1) this.d = x; }
let v13: any;
function F14(this: any, x: number) { this.d = x; this.a = x; }
function G14(this: any, x: number) { this.d = x; if (x & 1) this.a = x; }
let v14: any;
function F15(this: any, x: number) { this.d = x; this.b = x; }
function G15(this: any, x: number) { this.d = x; if (x & 1) this.b = x; }
let v15: any;
function F16(this: any, x: number) { this.d = x; this.c = x; }
function G16(this: any, x: number) { this.d = x; if (x & 1) this.c = x; }
let v16: any;
function F17(this: any, x: number) { this.a = x; this.b = x; this.c = x; }
function G17(this: any, x: number) { this.a = x; if (x & 1) this.b = x; this.c = x; }
let v17: any;
function F18(this: any, x: number) { this.a = x; this.b = x; this.d = x; }
function G18(this: any, x: number) { this.a = x; if (x & 1) this.b = x; this.d = x; }
let v18: any;
function F19(this: any, x: number) { this.a = x; this.c = x; this.b = x; }
function G19(this: any, x: number) { this.a = x; if (x & 1) this.c = x; this.b = x; }
let v19: any;
function F20(this: any, x: number) { this.a = x; this.c = x; this.d = x; }
function G20(this: any, x: number) { this.a = x; if (x & 1) this.c = x; this.d = x; }
let v20: any;
function F21(this: any, x: number) { this.a = x; this.d = x; this.b = x; }
function G21(this: any, x: number) { this.a = x; if (x & 1) this.d = x; this.b = x; }
let v21: any;
function F22(this: any, x: number) { this.a = x; this.d = x; this.c = x; }
function G22(this: any, x: number) { this.a = x; if (x & 1) this.d = x; this.c = x; }
let v22: any;
function F23(this: any, x: number) { this.b = x; this.a = x; this.c = x; }
function G23(this: any, x: number) { this.b = x; if (x & 1) this.a = x; this.c = x; }
let v23: any;
function F24(this: any, x: number) { this.b = x; this.a = x; this.d = x; }
function G24(this: any, x: number) { this.b = x; if (x & 1) this.a = x; this.d = x; }
let v24: any;
function F25(this: any, x: number) { this.b = x; this.c = x; this.a = x; }
function G25(this: any, x: number) { this.b = x; if (x & 1) this.c = x; this.a = x; }
let v25: any;
function F26(this: any, x: number) { this.b = x; this.c = x; this.d = x; }
function G26(this: any, x: number) { this.b = x; if (x & 1) this.c = x; this.d = x; }
let v26: any;
function F27(this: any, x: number) { this.b = x; this.d = x; this.a = x; }
function G27(this: any, x: number) { this.b = x; if (x & 1) this.d = x; this.a = x; }
let v27: any;
function F28(this: any, x: number) { this.b = x; this.d = x; this.c = x; }
function G28(this: any, x: number) { this.b = x; if (x & 1) this.d = x; this.c = x; }
let v28: any;
function F29(this: any, x: number) { this.c = x; this.a = x; this.b = x; }
function G29(this: any, x: number) { this.c = x; if (x & 1) this.a = x; this.b = x; }
let v29: any;
function F30(this: any, x: number) { this.c = x; this.a = x; this.d = x; }
function G30(this: any, x: number) { this.c = x; if (x & 1) this.a = x; this.d = x; }
let v30: any;
function F31(this: any, x: number) { this.c = x; this.b = x; this.a = x; }
function G31(this: any, x: number) { this.c = x; if (x & 1) this.b = x; this.a = x; }
let v31: any;
function F32(this: any, x: number) { this.c = x; this.b = x; this.d = x; }
function G32(this: any, x: number) { this.c = x; if (x & 1) this.b = x; this.d = x; }
let v32: any;
function F33(this: any, x: number) { this.c = x; this.d = x; this.a = x; }
function G33(this: any, x: number) { this.c = x; if (x & 1) this.d = x; this.a = x; }
let v33: any;
function F34(this: any, x: number) { this.c = x; this.d = x; this.b = x; }
function G34(this: any, x: number) { this.c = x; if (x & 1) this.d = x; this.b = x; }
let v34: any;
function F35(this: any, x: number) { this.d = x; this.a = x; this.b = x; }
function G35(this: any, x: number) { this.d = x; if (x & 1) this.a = x; this.b = x; }
let v35: any;
function F36(this: any, x: number) { this.d = x; this.a = x; this.c = x; }
function G36(this: any, x: number) { this.d = x; if (x & 1) this.a = x; this.c = x; }
let v36: any;
function F37(this: any, x: number) { this.d = x; this.b = x; this.a = x; }
function G37(this: any, x: number) { this.d = x; if (x & 1) this.b = x; this.a = x; }
let v37: any;
function F38(this: any, x: number) { this.d = x; this.b = x; this.c = x; }
function G38(this: any, x: number) { this.d = x; if (x & 1) this.b = x; this.c = x; }
let v38: any;
function F39(this: any, x: number) { this.d = x; this.c = x; this.a = x; }
function G39(this: any, x: number) { this.d = x; if (x & 1) this.c = x; this.a = x; }
let v39: any;
function F40(this: any, x: number) { this.d = x; this.c = x; this.b = x; }
function G40(this: any, x: number) { this.d = x; if (x & 1) this.c = x; this.b = x; }
let v40: any;
function F41(this: any, x: number) { this.a = x; this.b = x; this.c = x; this.d = x; }
function G41(this: any, x: number) { this.a = x; if (x & 1) this.b = x; this.c = x; this.d = x; }
let v41: any;
function F42(this: any, x: number) { this.a = x; this.b = x; this.d = x; this.c = x; }
function G42(this: any, x: number) { this.a = x; if (x & 1) this.b = x; this.d = x; this.c = x; }
let v42: any;
function F43(this: any, x: number) { this.a = x; this.c = x; this.b = x; this.d = x; }
function G43(this: any, x: number) { this.a = x; if (x & 1) this.c = x; this.b = x; this.d = x; }
let v43: any;
function F44(this: any, x: number) { this.a = x; this.c = x; this.d = x; this.b = x; }
function G44(this: any, x: number) { this.a = x; if (x & 1) this.c = x; this.d = x; this.b = x; }
let v44: any;
function F45(this: any, x: number) { this.a = x; this.d = x; this.b = x; this.c = x; }
function G45(this: any, x: number) { this.a = x; if (x & 1) this.d = x; this.b = x; this.c = x; }
let v45: any;
function F46(this: any, x: number) { this.a = x; this.d = x; this.c = x; this.b = x; }
function G46(this: any, x: number) { this.a = x; if (x & 1) this.d = x; this.c = x; this.b = x; }
let v46: any;
function F47(this: any, x: number) { this.b = x; this.a = x; this.c = x; this.d = x; }
function G47(this: any, x: number) { this.b = x; if (x & 1) this.a = x; this.c = x; this.d = x; }
let v47: any;
function F48(this: any, x: number) { this.b = x; this.a = x; this.d = x; this.c = x; }
function G48(this: any, x: number) { this.b = x; if (x & 1) this.a = x; this.d = x; this.c = x; }
let v48: any;
function F49(this: any, x: number) { this.b = x; this.c = x; this.a = x; this.d = x; }
function G49(this: any, x: number) { this.b = x; if (x & 1) this.c = x; this.a = x; this.d = x; }
let v49: any;
function F50(this: any, x: number) { this.b = x; this.c = x; this.d = x; this.a = x; }
function G50(this: any, x: number) { this.b = x; if (x & 1) this.c = x; this.d = x; this.a = x; }
let v50: any;
function F51(this: any, x: number) { this.b = x; this.d = x; this.a = x; this.c = x; }
function G51(this: any, x: number) { this.b = x; if (x & 1) this.d = x; this.a = x; this.c = x; }
let v51: any;
function F52(this: any, x: number) { this.b = x; this.d = x; this.c = x; this.a = x; }
function G52(this: any, x: number) { this.b = x; if (x & 1) this.d = x; this.c = x; this.a = x; }
let v52: any;
function F53(this: any, x: number) { this.c = x; this.a = x; this.b = x; this.d = x; }
function G53(this: any, x: number) { this.c = x; if (x & 1) this.a = x; this.b = x; this.d = x; }
let v53: any;
function F54(this: any, x: number) { this.c = x; this.a = x; this.d = x; this.b = x; }
function G54(this: any, x: number) { this.c = x; if (x & 1) this.a = x; this.d = x; this.b = x; }
let v54: any;
function F55(this: any, x: number) { this.c = x; this.b = x; this.a = x; this.d = x; }
function G55(this: any, x: number) { this.c = x; if (x & 1) this.b = x; this.a = x; this.d = x; }
let v55: any;
function F56(this: any, x: number) { this.c = x; this.b = x; this.d = x; this.a = x; }
function G56(this: any, x: number) { this.c = x; if (x & 1) this.b = x; this.d = x; this.a = x; }
let v56: any;
function F57(this: any, x: number) { this.c = x; this.d = x; this.a = x; this.b = x; }
function G57(this: any, x: number) { this.c = x; if (x & 1) this.d = x; this.a = x; this.b = x; }
let v57: any;
function F58(this: any, x: number) { this.c = x; this.d = x; this.b = x; this.a = x; }
function G58(this: any, x: number) { this.c = x; if (x & 1) this.d = x; this.b = x; this.a = x; }
let v58: any;
function F59(this: any, x: number) { this.d = x; this.a = x; this.b = x; this.c = x; }
function G59(this: any, x: number) { this.d = x; if (x & 1) this.a = x; this.b = x; this.c = x; }
let v59: any;
function F60(this: any, x: number) { this.d = x; this.a = x; this.c = x; this.b = x; }
function G60(this: any, x: number) { this.d = x; if (x & 1) this.a = x; this.c = x; this.b = x; }
let v60: any;
function F61(this: any, x: number) { this.d = x; this.b = x; this.a = x; this.c = x; }
function G61(this: any, x: number) { this.d = x; if (x & 1) this.b = x; this.a = x; this.c = x; }
let v61: any;
function F62(this: any, x: number) { this.d = x; this.b = x; this.c = x; this.a = x; }
function G62(this: any, x: number) { this.d = x; if (x & 1) this.b = x; this.c = x; this.a = x; }
let v62: any;
function F63(this: any, x: number) { this.d = x; this.c = x; this.a = x; this.b = x; }
function G63(this: any, x: number) { this.d = x; if (x & 1) this.c = x; this.a = x; this.b = x; }
let v63: any;
function F64(this: any, x: number) { this.d = x; this.c = x; this.b = x; this.a = x; }
function G64(this: any, x: number) { this.d = x; if (x & 1) this.c = x; this.b = x; this.a = x; }
let v64: any;
function f0(x: number): R { const p: R = new (F0 as any)(x); p.a = x + 1; return p; }
function f1(x: number): R { const p: R = new v0(x); p.a = x + 1; return p; }
function f2(x: number): R { const p: R = new (G0 as any)(x); p.a = x + 1; return p; }
function f3(x: number): R { const p: R = new (F0 as any)(x); p.b = x + 1; return p; }
function f4(x: number): R { const p: R = new v0(x); p.b = x + 1; return p; }
function f5(x: number): R { const p: R = new (G0 as any)(x); p.b = x + 1; return p; }
function f6(x: number): R { const p: R = new (F0 as any)(x); p.c = x + 1; return p; }
function f7(x: number): R { const p: R = new v0(x); p.c = x + 1; return p; }
function f8(x: number): R { const p: R = new (G0 as any)(x); p.c = x + 1; return p; }
function f9(x: number): R { const p: R = new (F0 as any)(x); p.d = x + 1; return p; }
function f10(x: number): R { const p: R = new v0(x); p.d = x + 1; return p; }
function f11(x: number): R { const p: R = new (G0 as any)(x); p.d = x + 1; return p; }
function f12(x: number): R { const p: R = new (F0 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f13(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f14(x: number): R { const p: R = new v0(x); p.a = x + 1; p.a = x + 2; return p; }
function f15(x: number): R { const p: R = new (G0 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f16(x: number): R { const p: R = new (F0 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f17(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f18(x: number): R { const p: R = new v0(x); p.a = x + 1; p.b = x + 2; return p; }
function f19(x: number): R { const p: R = new (G0 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f20(x: number): R { const p: R = new (F0 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f21(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f22(x: number): R { const p: R = new v0(x); p.a = x + 1; p.c = x + 2; return p; }
function f23(x: number): R { const p: R = new (G0 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f24(x: number): R { const p: R = new (F0 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f25(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f26(x: number): R { const p: R = new v0(x); p.a = x + 1; p.d = x + 2; return p; }
function f27(x: number): R { const p: R = new (G0 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f28(x: number): R { const p: R = new (F0 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f29(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f30(x: number): R { const p: R = new v0(x); p.b = x + 1; p.a = x + 2; return p; }
function f31(x: number): R { const p: R = new (G0 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f32(x: number): R { const p: R = new (F0 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f33(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f34(x: number): R { const p: R = new v0(x); p.b = x + 1; p.b = x + 2; return p; }
function f35(x: number): R { const p: R = new (G0 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f36(x: number): R { const p: R = new (F0 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f37(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f38(x: number): R { const p: R = new v0(x); p.b = x + 1; p.c = x + 2; return p; }
function f39(x: number): R { const p: R = new (G0 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f40(x: number): R { const p: R = new (F0 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f41(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f42(x: number): R { const p: R = new v0(x); p.b = x + 1; p.d = x + 2; return p; }
function f43(x: number): R { const p: R = new (G0 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f44(x: number): R { const p: R = new (F0 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f45(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f46(x: number): R { const p: R = new v0(x); p.c = x + 1; p.a = x + 2; return p; }
function f47(x: number): R { const p: R = new (G0 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f48(x: number): R { const p: R = new (F0 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f49(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f50(x: number): R { const p: R = new v0(x); p.c = x + 1; p.b = x + 2; return p; }
function f51(x: number): R { const p: R = new (G0 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f52(x: number): R { const p: R = new (F0 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f53(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f54(x: number): R { const p: R = new v0(x); p.c = x + 1; p.c = x + 2; return p; }
function f55(x: number): R { const p: R = new (G0 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f56(x: number): R { const p: R = new (F0 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f57(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f58(x: number): R { const p: R = new v0(x); p.c = x + 1; p.d = x + 2; return p; }
function f59(x: number): R { const p: R = new (G0 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f60(x: number): R { const p: R = new (F0 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f61(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f62(x: number): R { const p: R = new v0(x); p.d = x + 1; p.a = x + 2; return p; }
function f63(x: number): R { const p: R = new (G0 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f64(x: number): R { const p: R = new (F0 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f65(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f66(x: number): R { const p: R = new v0(x); p.d = x + 1; p.b = x + 2; return p; }
function f67(x: number): R { const p: R = new (G0 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f68(x: number): R { const p: R = new (F0 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f69(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f70(x: number): R { const p: R = new v0(x); p.d = x + 1; p.c = x + 2; return p; }
function f71(x: number): R { const p: R = new (G0 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f72(x: number): R { const p: R = new (F0 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f73(x: number): R { const p: R = new (F0 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f74(x: number): R { const p: R = new v0(x); p.d = x + 1; p.d = x + 2; return p; }
function f75(x: number): R { const p: R = new (G0 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f76(x: number): R { const p: R = new (F1 as any)(x); p.a = x + 1; return p; }
function f77(x: number): R { const p: R = new v1(x); p.a = x + 1; return p; }
function f78(x: number): R { const p: R = new (G1 as any)(x); p.a = x + 1; return p; }
function f79(x: number): R { const p: R = new (F1 as any)(x); p.b = x + 1; return p; }
function f80(x: number): R { const p: R = new v1(x); p.b = x + 1; return p; }
function f81(x: number): R { const p: R = new (G1 as any)(x); p.b = x + 1; return p; }
function f82(x: number): R { const p: R = new (F1 as any)(x); p.c = x + 1; return p; }
function f83(x: number): R { const p: R = new v1(x); p.c = x + 1; return p; }
function f84(x: number): R { const p: R = new (G1 as any)(x); p.c = x + 1; return p; }
function f85(x: number): R { const p: R = new (F1 as any)(x); p.d = x + 1; return p; }
function f86(x: number): R { const p: R = new v1(x); p.d = x + 1; return p; }
function f87(x: number): R { const p: R = new (G1 as any)(x); p.d = x + 1; return p; }
function f88(x: number): R { const p: R = new (F1 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f89(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f90(x: number): R { const p: R = new v1(x); p.a = x + 1; p.a = x + 2; return p; }
function f91(x: number): R { const p: R = new (G1 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f92(x: number): R { const p: R = new (F1 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f93(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f94(x: number): R { const p: R = new v1(x); p.a = x + 1; p.b = x + 2; return p; }
function f95(x: number): R { const p: R = new (G1 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f96(x: number): R { const p: R = new (F1 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f97(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f98(x: number): R { const p: R = new v1(x); p.a = x + 1; p.c = x + 2; return p; }
function f99(x: number): R { const p: R = new (G1 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f100(x: number): R { const p: R = new (F1 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f101(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f102(x: number): R { const p: R = new v1(x); p.a = x + 1; p.d = x + 2; return p; }
function f103(x: number): R { const p: R = new (G1 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f104(x: number): R { const p: R = new (F1 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f105(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f106(x: number): R { const p: R = new v1(x); p.b = x + 1; p.a = x + 2; return p; }
function f107(x: number): R { const p: R = new (G1 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f108(x: number): R { const p: R = new (F1 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f109(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f110(x: number): R { const p: R = new v1(x); p.b = x + 1; p.b = x + 2; return p; }
function f111(x: number): R { const p: R = new (G1 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f112(x: number): R { const p: R = new (F1 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f113(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f114(x: number): R { const p: R = new v1(x); p.b = x + 1; p.c = x + 2; return p; }
function f115(x: number): R { const p: R = new (G1 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f116(x: number): R { const p: R = new (F1 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f117(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f118(x: number): R { const p: R = new v1(x); p.b = x + 1; p.d = x + 2; return p; }
function f119(x: number): R { const p: R = new (G1 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f120(x: number): R { const p: R = new (F1 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f121(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f122(x: number): R { const p: R = new v1(x); p.c = x + 1; p.a = x + 2; return p; }
function f123(x: number): R { const p: R = new (G1 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f124(x: number): R { const p: R = new (F1 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f125(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f126(x: number): R { const p: R = new v1(x); p.c = x + 1; p.b = x + 2; return p; }
function f127(x: number): R { const p: R = new (G1 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f128(x: number): R { const p: R = new (F1 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f129(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f130(x: number): R { const p: R = new v1(x); p.c = x + 1; p.c = x + 2; return p; }
function f131(x: number): R { const p: R = new (G1 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f132(x: number): R { const p: R = new (F1 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f133(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f134(x: number): R { const p: R = new v1(x); p.c = x + 1; p.d = x + 2; return p; }
function f135(x: number): R { const p: R = new (G1 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f136(x: number): R { const p: R = new (F1 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f137(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f138(x: number): R { const p: R = new v1(x); p.d = x + 1; p.a = x + 2; return p; }
function f139(x: number): R { const p: R = new (G1 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f140(x: number): R { const p: R = new (F1 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f141(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f142(x: number): R { const p: R = new v1(x); p.d = x + 1; p.b = x + 2; return p; }
function f143(x: number): R { const p: R = new (G1 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f144(x: number): R { const p: R = new (F1 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f145(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f146(x: number): R { const p: R = new v1(x); p.d = x + 1; p.c = x + 2; return p; }
function f147(x: number): R { const p: R = new (G1 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f148(x: number): R { const p: R = new (F1 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f149(x: number): R { const p: R = new (F1 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f150(x: number): R { const p: R = new v1(x); p.d = x + 1; p.d = x + 2; return p; }
function f151(x: number): R { const p: R = new (G1 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f152(x: number): R { const p: R = new (F2 as any)(x); p.a = x + 1; return p; }
function f153(x: number): R { const p: R = new v2(x); p.a = x + 1; return p; }
function f154(x: number): R { const p: R = new (G2 as any)(x); p.a = x + 1; return p; }
function f155(x: number): R { const p: R = new (F2 as any)(x); p.b = x + 1; return p; }
function f156(x: number): R { const p: R = new v2(x); p.b = x + 1; return p; }
function f157(x: number): R { const p: R = new (G2 as any)(x); p.b = x + 1; return p; }
function f158(x: number): R { const p: R = new (F2 as any)(x); p.c = x + 1; return p; }
function f159(x: number): R { const p: R = new v2(x); p.c = x + 1; return p; }
function f160(x: number): R { const p: R = new (G2 as any)(x); p.c = x + 1; return p; }
function f161(x: number): R { const p: R = new (F2 as any)(x); p.d = x + 1; return p; }
function f162(x: number): R { const p: R = new v2(x); p.d = x + 1; return p; }
function f163(x: number): R { const p: R = new (G2 as any)(x); p.d = x + 1; return p; }
function f164(x: number): R { const p: R = new (F2 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f165(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f166(x: number): R { const p: R = new v2(x); p.a = x + 1; p.a = x + 2; return p; }
function f167(x: number): R { const p: R = new (G2 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f168(x: number): R { const p: R = new (F2 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f169(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f170(x: number): R { const p: R = new v2(x); p.a = x + 1; p.b = x + 2; return p; }
function f171(x: number): R { const p: R = new (G2 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f172(x: number): R { const p: R = new (F2 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f173(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f174(x: number): R { const p: R = new v2(x); p.a = x + 1; p.c = x + 2; return p; }
function f175(x: number): R { const p: R = new (G2 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f176(x: number): R { const p: R = new (F2 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f177(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f178(x: number): R { const p: R = new v2(x); p.a = x + 1; p.d = x + 2; return p; }
function f179(x: number): R { const p: R = new (G2 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f180(x: number): R { const p: R = new (F2 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f181(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f182(x: number): R { const p: R = new v2(x); p.b = x + 1; p.a = x + 2; return p; }
function f183(x: number): R { const p: R = new (G2 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f184(x: number): R { const p: R = new (F2 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f185(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f186(x: number): R { const p: R = new v2(x); p.b = x + 1; p.b = x + 2; return p; }
function f187(x: number): R { const p: R = new (G2 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f188(x: number): R { const p: R = new (F2 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f189(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f190(x: number): R { const p: R = new v2(x); p.b = x + 1; p.c = x + 2; return p; }
function f191(x: number): R { const p: R = new (G2 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f192(x: number): R { const p: R = new (F2 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f193(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f194(x: number): R { const p: R = new v2(x); p.b = x + 1; p.d = x + 2; return p; }
function f195(x: number): R { const p: R = new (G2 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f196(x: number): R { const p: R = new (F2 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f197(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f198(x: number): R { const p: R = new v2(x); p.c = x + 1; p.a = x + 2; return p; }
function f199(x: number): R { const p: R = new (G2 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f200(x: number): R { const p: R = new (F2 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f201(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f202(x: number): R { const p: R = new v2(x); p.c = x + 1; p.b = x + 2; return p; }
function f203(x: number): R { const p: R = new (G2 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f204(x: number): R { const p: R = new (F2 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f205(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f206(x: number): R { const p: R = new v2(x); p.c = x + 1; p.c = x + 2; return p; }
function f207(x: number): R { const p: R = new (G2 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f208(x: number): R { const p: R = new (F2 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f209(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f210(x: number): R { const p: R = new v2(x); p.c = x + 1; p.d = x + 2; return p; }
function f211(x: number): R { const p: R = new (G2 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f212(x: number): R { const p: R = new (F2 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f213(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f214(x: number): R { const p: R = new v2(x); p.d = x + 1; p.a = x + 2; return p; }
function f215(x: number): R { const p: R = new (G2 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f216(x: number): R { const p: R = new (F2 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f217(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f218(x: number): R { const p: R = new v2(x); p.d = x + 1; p.b = x + 2; return p; }
function f219(x: number): R { const p: R = new (G2 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f220(x: number): R { const p: R = new (F2 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f221(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f222(x: number): R { const p: R = new v2(x); p.d = x + 1; p.c = x + 2; return p; }
function f223(x: number): R { const p: R = new (G2 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f224(x: number): R { const p: R = new (F2 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f225(x: number): R { const p: R = new (F2 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f226(x: number): R { const p: R = new v2(x); p.d = x + 1; p.d = x + 2; return p; }
function f227(x: number): R { const p: R = new (G2 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f228(x: number): R { const p: R = new (F3 as any)(x); p.a = x + 1; return p; }
function f229(x: number): R { const p: R = new v3(x); p.a = x + 1; return p; }
function f230(x: number): R { const p: R = new (G3 as any)(x); p.a = x + 1; return p; }
function f231(x: number): R { const p: R = new (F3 as any)(x); p.b = x + 1; return p; }
function f232(x: number): R { const p: R = new v3(x); p.b = x + 1; return p; }
function f233(x: number): R { const p: R = new (G3 as any)(x); p.b = x + 1; return p; }
function f234(x: number): R { const p: R = new (F3 as any)(x); p.c = x + 1; return p; }
function f235(x: number): R { const p: R = new v3(x); p.c = x + 1; return p; }
function f236(x: number): R { const p: R = new (G3 as any)(x); p.c = x + 1; return p; }
function f237(x: number): R { const p: R = new (F3 as any)(x); p.d = x + 1; return p; }
function f238(x: number): R { const p: R = new v3(x); p.d = x + 1; return p; }
function f239(x: number): R { const p: R = new (G3 as any)(x); p.d = x + 1; return p; }
function f240(x: number): R { const p: R = new (F3 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f241(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f242(x: number): R { const p: R = new v3(x); p.a = x + 1; p.a = x + 2; return p; }
function f243(x: number): R { const p: R = new (G3 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f244(x: number): R { const p: R = new (F3 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f245(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f246(x: number): R { const p: R = new v3(x); p.a = x + 1; p.b = x + 2; return p; }
function f247(x: number): R { const p: R = new (G3 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f248(x: number): R { const p: R = new (F3 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f249(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f250(x: number): R { const p: R = new v3(x); p.a = x + 1; p.c = x + 2; return p; }
function f251(x: number): R { const p: R = new (G3 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f252(x: number): R { const p: R = new (F3 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f253(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f254(x: number): R { const p: R = new v3(x); p.a = x + 1; p.d = x + 2; return p; }
function f255(x: number): R { const p: R = new (G3 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f256(x: number): R { const p: R = new (F3 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f257(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f258(x: number): R { const p: R = new v3(x); p.b = x + 1; p.a = x + 2; return p; }
function f259(x: number): R { const p: R = new (G3 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f260(x: number): R { const p: R = new (F3 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f261(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f262(x: number): R { const p: R = new v3(x); p.b = x + 1; p.b = x + 2; return p; }
function f263(x: number): R { const p: R = new (G3 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f264(x: number): R { const p: R = new (F3 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f265(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f266(x: number): R { const p: R = new v3(x); p.b = x + 1; p.c = x + 2; return p; }
function f267(x: number): R { const p: R = new (G3 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f268(x: number): R { const p: R = new (F3 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f269(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f270(x: number): R { const p: R = new v3(x); p.b = x + 1; p.d = x + 2; return p; }
function f271(x: number): R { const p: R = new (G3 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f272(x: number): R { const p: R = new (F3 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f273(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f274(x: number): R { const p: R = new v3(x); p.c = x + 1; p.a = x + 2; return p; }
function f275(x: number): R { const p: R = new (G3 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f276(x: number): R { const p: R = new (F3 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f277(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f278(x: number): R { const p: R = new v3(x); p.c = x + 1; p.b = x + 2; return p; }
function f279(x: number): R { const p: R = new (G3 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f280(x: number): R { const p: R = new (F3 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f281(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f282(x: number): R { const p: R = new v3(x); p.c = x + 1; p.c = x + 2; return p; }
function f283(x: number): R { const p: R = new (G3 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f284(x: number): R { const p: R = new (F3 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f285(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f286(x: number): R { const p: R = new v3(x); p.c = x + 1; p.d = x + 2; return p; }
function f287(x: number): R { const p: R = new (G3 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f288(x: number): R { const p: R = new (F3 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f289(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f290(x: number): R { const p: R = new v3(x); p.d = x + 1; p.a = x + 2; return p; }
function f291(x: number): R { const p: R = new (G3 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f292(x: number): R { const p: R = new (F3 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f293(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f294(x: number): R { const p: R = new v3(x); p.d = x + 1; p.b = x + 2; return p; }
function f295(x: number): R { const p: R = new (G3 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f296(x: number): R { const p: R = new (F3 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f297(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f298(x: number): R { const p: R = new v3(x); p.d = x + 1; p.c = x + 2; return p; }
function f299(x: number): R { const p: R = new (G3 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f300(x: number): R { const p: R = new (F3 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f301(x: number): R { const p: R = new (F3 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f302(x: number): R { const p: R = new v3(x); p.d = x + 1; p.d = x + 2; return p; }
function f303(x: number): R { const p: R = new (G3 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f304(x: number): R { const p: R = new (F4 as any)(x); p.a = x + 1; return p; }
function f305(x: number): R { const p: R = new v4(x); p.a = x + 1; return p; }
function f306(x: number): R { const p: R = new (G4 as any)(x); p.a = x + 1; return p; }
function f307(x: number): R { const p: R = new (F4 as any)(x); p.b = x + 1; return p; }
function f308(x: number): R { const p: R = new v4(x); p.b = x + 1; return p; }
function f309(x: number): R { const p: R = new (G4 as any)(x); p.b = x + 1; return p; }
function f310(x: number): R { const p: R = new (F4 as any)(x); p.c = x + 1; return p; }
function f311(x: number): R { const p: R = new v4(x); p.c = x + 1; return p; }
function f312(x: number): R { const p: R = new (G4 as any)(x); p.c = x + 1; return p; }
function f313(x: number): R { const p: R = new (F4 as any)(x); p.d = x + 1; return p; }
function f314(x: number): R { const p: R = new v4(x); p.d = x + 1; return p; }
function f315(x: number): R { const p: R = new (G4 as any)(x); p.d = x + 1; return p; }
function f316(x: number): R { const p: R = new (F4 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f317(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f318(x: number): R { const p: R = new v4(x); p.a = x + 1; p.a = x + 2; return p; }
function f319(x: number): R { const p: R = new (G4 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f320(x: number): R { const p: R = new (F4 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f321(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f322(x: number): R { const p: R = new v4(x); p.a = x + 1; p.b = x + 2; return p; }
function f323(x: number): R { const p: R = new (G4 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f324(x: number): R { const p: R = new (F4 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f325(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f326(x: number): R { const p: R = new v4(x); p.a = x + 1; p.c = x + 2; return p; }
function f327(x: number): R { const p: R = new (G4 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f328(x: number): R { const p: R = new (F4 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f329(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f330(x: number): R { const p: R = new v4(x); p.a = x + 1; p.d = x + 2; return p; }
function f331(x: number): R { const p: R = new (G4 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f332(x: number): R { const p: R = new (F4 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f333(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f334(x: number): R { const p: R = new v4(x); p.b = x + 1; p.a = x + 2; return p; }
function f335(x: number): R { const p: R = new (G4 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f336(x: number): R { const p: R = new (F4 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f337(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f338(x: number): R { const p: R = new v4(x); p.b = x + 1; p.b = x + 2; return p; }
function f339(x: number): R { const p: R = new (G4 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f340(x: number): R { const p: R = new (F4 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f341(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f342(x: number): R { const p: R = new v4(x); p.b = x + 1; p.c = x + 2; return p; }
function f343(x: number): R { const p: R = new (G4 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f344(x: number): R { const p: R = new (F4 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f345(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f346(x: number): R { const p: R = new v4(x); p.b = x + 1; p.d = x + 2; return p; }
function f347(x: number): R { const p: R = new (G4 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f348(x: number): R { const p: R = new (F4 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f349(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f350(x: number): R { const p: R = new v4(x); p.c = x + 1; p.a = x + 2; return p; }
function f351(x: number): R { const p: R = new (G4 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f352(x: number): R { const p: R = new (F4 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f353(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f354(x: number): R { const p: R = new v4(x); p.c = x + 1; p.b = x + 2; return p; }
function f355(x: number): R { const p: R = new (G4 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f356(x: number): R { const p: R = new (F4 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f357(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f358(x: number): R { const p: R = new v4(x); p.c = x + 1; p.c = x + 2; return p; }
function f359(x: number): R { const p: R = new (G4 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f360(x: number): R { const p: R = new (F4 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f361(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f362(x: number): R { const p: R = new v4(x); p.c = x + 1; p.d = x + 2; return p; }
function f363(x: number): R { const p: R = new (G4 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f364(x: number): R { const p: R = new (F4 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f365(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f366(x: number): R { const p: R = new v4(x); p.d = x + 1; p.a = x + 2; return p; }
function f367(x: number): R { const p: R = new (G4 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f368(x: number): R { const p: R = new (F4 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f369(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f370(x: number): R { const p: R = new v4(x); p.d = x + 1; p.b = x + 2; return p; }
function f371(x: number): R { const p: R = new (G4 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f372(x: number): R { const p: R = new (F4 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f373(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f374(x: number): R { const p: R = new v4(x); p.d = x + 1; p.c = x + 2; return p; }
function f375(x: number): R { const p: R = new (G4 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f376(x: number): R { const p: R = new (F4 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f377(x: number): R { const p: R = new (F4 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f378(x: number): R { const p: R = new v4(x); p.d = x + 1; p.d = x + 2; return p; }
function f379(x: number): R { const p: R = new (G4 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f380(x: number): R { const p: R = new (F5 as any)(x); p.a = x + 1; return p; }
function f381(x: number): R { const p: R = new v5(x); p.a = x + 1; return p; }
function f382(x: number): R { const p: R = new (G5 as any)(x); p.a = x + 1; return p; }
function f383(x: number): R { const p: R = new (F5 as any)(x); p.b = x + 1; return p; }
function f384(x: number): R { const p: R = new v5(x); p.b = x + 1; return p; }
function f385(x: number): R { const p: R = new (G5 as any)(x); p.b = x + 1; return p; }
function f386(x: number): R { const p: R = new (F5 as any)(x); p.c = x + 1; return p; }
function f387(x: number): R { const p: R = new v5(x); p.c = x + 1; return p; }
function f388(x: number): R { const p: R = new (G5 as any)(x); p.c = x + 1; return p; }
function f389(x: number): R { const p: R = new (F5 as any)(x); p.d = x + 1; return p; }
function f390(x: number): R { const p: R = new v5(x); p.d = x + 1; return p; }
function f391(x: number): R { const p: R = new (G5 as any)(x); p.d = x + 1; return p; }
function f392(x: number): R { const p: R = new (F5 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f393(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f394(x: number): R { const p: R = new v5(x); p.a = x + 1; p.a = x + 2; return p; }
function f395(x: number): R { const p: R = new (G5 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f396(x: number): R { const p: R = new (F5 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f397(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f398(x: number): R { const p: R = new v5(x); p.a = x + 1; p.b = x + 2; return p; }
function f399(x: number): R { const p: R = new (G5 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f400(x: number): R { const p: R = new (F5 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f401(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f402(x: number): R { const p: R = new v5(x); p.a = x + 1; p.c = x + 2; return p; }
function f403(x: number): R { const p: R = new (G5 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f404(x: number): R { const p: R = new (F5 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f405(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f406(x: number): R { const p: R = new v5(x); p.a = x + 1; p.d = x + 2; return p; }
function f407(x: number): R { const p: R = new (G5 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f408(x: number): R { const p: R = new (F5 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f409(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f410(x: number): R { const p: R = new v5(x); p.b = x + 1; p.a = x + 2; return p; }
function f411(x: number): R { const p: R = new (G5 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f412(x: number): R { const p: R = new (F5 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f413(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f414(x: number): R { const p: R = new v5(x); p.b = x + 1; p.b = x + 2; return p; }
function f415(x: number): R { const p: R = new (G5 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f416(x: number): R { const p: R = new (F5 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f417(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f418(x: number): R { const p: R = new v5(x); p.b = x + 1; p.c = x + 2; return p; }
function f419(x: number): R { const p: R = new (G5 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f420(x: number): R { const p: R = new (F5 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f421(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f422(x: number): R { const p: R = new v5(x); p.b = x + 1; p.d = x + 2; return p; }
function f423(x: number): R { const p: R = new (G5 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f424(x: number): R { const p: R = new (F5 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f425(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f426(x: number): R { const p: R = new v5(x); p.c = x + 1; p.a = x + 2; return p; }
function f427(x: number): R { const p: R = new (G5 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f428(x: number): R { const p: R = new (F5 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f429(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f430(x: number): R { const p: R = new v5(x); p.c = x + 1; p.b = x + 2; return p; }
function f431(x: number): R { const p: R = new (G5 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f432(x: number): R { const p: R = new (F5 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f433(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f434(x: number): R { const p: R = new v5(x); p.c = x + 1; p.c = x + 2; return p; }
function f435(x: number): R { const p: R = new (G5 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f436(x: number): R { const p: R = new (F5 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f437(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f438(x: number): R { const p: R = new v5(x); p.c = x + 1; p.d = x + 2; return p; }
function f439(x: number): R { const p: R = new (G5 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f440(x: number): R { const p: R = new (F5 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f441(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f442(x: number): R { const p: R = new v5(x); p.d = x + 1; p.a = x + 2; return p; }
function f443(x: number): R { const p: R = new (G5 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f444(x: number): R { const p: R = new (F5 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f445(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f446(x: number): R { const p: R = new v5(x); p.d = x + 1; p.b = x + 2; return p; }
function f447(x: number): R { const p: R = new (G5 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f448(x: number): R { const p: R = new (F5 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f449(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f450(x: number): R { const p: R = new v5(x); p.d = x + 1; p.c = x + 2; return p; }
function f451(x: number): R { const p: R = new (G5 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f452(x: number): R { const p: R = new (F5 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f453(x: number): R { const p: R = new (F5 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f454(x: number): R { const p: R = new v5(x); p.d = x + 1; p.d = x + 2; return p; }
function f455(x: number): R { const p: R = new (G5 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f456(x: number): R { const p: R = new (F6 as any)(x); p.a = x + 1; return p; }
function f457(x: number): R { const p: R = new v6(x); p.a = x + 1; return p; }
function f458(x: number): R { const p: R = new (G6 as any)(x); p.a = x + 1; return p; }
function f459(x: number): R { const p: R = new (F6 as any)(x); p.b = x + 1; return p; }
function f460(x: number): R { const p: R = new v6(x); p.b = x + 1; return p; }
function f461(x: number): R { const p: R = new (G6 as any)(x); p.b = x + 1; return p; }
function f462(x: number): R { const p: R = new (F6 as any)(x); p.c = x + 1; return p; }
function f463(x: number): R { const p: R = new v6(x); p.c = x + 1; return p; }
function f464(x: number): R { const p: R = new (G6 as any)(x); p.c = x + 1; return p; }
function f465(x: number): R { const p: R = new (F6 as any)(x); p.d = x + 1; return p; }
function f466(x: number): R { const p: R = new v6(x); p.d = x + 1; return p; }
function f467(x: number): R { const p: R = new (G6 as any)(x); p.d = x + 1; return p; }
function f468(x: number): R { const p: R = new (F6 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f469(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f470(x: number): R { const p: R = new v6(x); p.a = x + 1; p.a = x + 2; return p; }
function f471(x: number): R { const p: R = new (G6 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f472(x: number): R { const p: R = new (F6 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f473(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f474(x: number): R { const p: R = new v6(x); p.a = x + 1; p.b = x + 2; return p; }
function f475(x: number): R { const p: R = new (G6 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f476(x: number): R { const p: R = new (F6 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f477(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f478(x: number): R { const p: R = new v6(x); p.a = x + 1; p.c = x + 2; return p; }
function f479(x: number): R { const p: R = new (G6 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f480(x: number): R { const p: R = new (F6 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f481(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f482(x: number): R { const p: R = new v6(x); p.a = x + 1; p.d = x + 2; return p; }
function f483(x: number): R { const p: R = new (G6 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f484(x: number): R { const p: R = new (F6 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f485(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f486(x: number): R { const p: R = new v6(x); p.b = x + 1; p.a = x + 2; return p; }
function f487(x: number): R { const p: R = new (G6 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f488(x: number): R { const p: R = new (F6 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f489(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f490(x: number): R { const p: R = new v6(x); p.b = x + 1; p.b = x + 2; return p; }
function f491(x: number): R { const p: R = new (G6 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f492(x: number): R { const p: R = new (F6 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f493(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f494(x: number): R { const p: R = new v6(x); p.b = x + 1; p.c = x + 2; return p; }
function f495(x: number): R { const p: R = new (G6 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f496(x: number): R { const p: R = new (F6 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f497(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f498(x: number): R { const p: R = new v6(x); p.b = x + 1; p.d = x + 2; return p; }
function f499(x: number): R { const p: R = new (G6 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f500(x: number): R { const p: R = new (F6 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f501(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f502(x: number): R { const p: R = new v6(x); p.c = x + 1; p.a = x + 2; return p; }
function f503(x: number): R { const p: R = new (G6 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f504(x: number): R { const p: R = new (F6 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f505(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f506(x: number): R { const p: R = new v6(x); p.c = x + 1; p.b = x + 2; return p; }
function f507(x: number): R { const p: R = new (G6 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f508(x: number): R { const p: R = new (F6 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f509(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f510(x: number): R { const p: R = new v6(x); p.c = x + 1; p.c = x + 2; return p; }
function f511(x: number): R { const p: R = new (G6 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f512(x: number): R { const p: R = new (F6 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f513(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f514(x: number): R { const p: R = new v6(x); p.c = x + 1; p.d = x + 2; return p; }
function f515(x: number): R { const p: R = new (G6 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f516(x: number): R { const p: R = new (F6 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f517(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f518(x: number): R { const p: R = new v6(x); p.d = x + 1; p.a = x + 2; return p; }
function f519(x: number): R { const p: R = new (G6 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f520(x: number): R { const p: R = new (F6 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f521(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f522(x: number): R { const p: R = new v6(x); p.d = x + 1; p.b = x + 2; return p; }
function f523(x: number): R { const p: R = new (G6 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f524(x: number): R { const p: R = new (F6 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f525(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f526(x: number): R { const p: R = new v6(x); p.d = x + 1; p.c = x + 2; return p; }
function f527(x: number): R { const p: R = new (G6 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f528(x: number): R { const p: R = new (F6 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f529(x: number): R { const p: R = new (F6 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f530(x: number): R { const p: R = new v6(x); p.d = x + 1; p.d = x + 2; return p; }
function f531(x: number): R { const p: R = new (G6 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f532(x: number): R { const p: R = new (F7 as any)(x); p.a = x + 1; return p; }
function f533(x: number): R { const p: R = new v7(x); p.a = x + 1; return p; }
function f534(x: number): R { const p: R = new (G7 as any)(x); p.a = x + 1; return p; }
function f535(x: number): R { const p: R = new (F7 as any)(x); p.b = x + 1; return p; }
function f536(x: number): R { const p: R = new v7(x); p.b = x + 1; return p; }
function f537(x: number): R { const p: R = new (G7 as any)(x); p.b = x + 1; return p; }
function f538(x: number): R { const p: R = new (F7 as any)(x); p.c = x + 1; return p; }
function f539(x: number): R { const p: R = new v7(x); p.c = x + 1; return p; }
function f540(x: number): R { const p: R = new (G7 as any)(x); p.c = x + 1; return p; }
function f541(x: number): R { const p: R = new (F7 as any)(x); p.d = x + 1; return p; }
function f542(x: number): R { const p: R = new v7(x); p.d = x + 1; return p; }
function f543(x: number): R { const p: R = new (G7 as any)(x); p.d = x + 1; return p; }
function f544(x: number): R { const p: R = new (F7 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f545(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f546(x: number): R { const p: R = new v7(x); p.a = x + 1; p.a = x + 2; return p; }
function f547(x: number): R { const p: R = new (G7 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f548(x: number): R { const p: R = new (F7 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f549(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f550(x: number): R { const p: R = new v7(x); p.a = x + 1; p.b = x + 2; return p; }
function f551(x: number): R { const p: R = new (G7 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f552(x: number): R { const p: R = new (F7 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f553(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f554(x: number): R { const p: R = new v7(x); p.a = x + 1; p.c = x + 2; return p; }
function f555(x: number): R { const p: R = new (G7 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f556(x: number): R { const p: R = new (F7 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f557(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f558(x: number): R { const p: R = new v7(x); p.a = x + 1; p.d = x + 2; return p; }
function f559(x: number): R { const p: R = new (G7 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f560(x: number): R { const p: R = new (F7 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f561(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f562(x: number): R { const p: R = new v7(x); p.b = x + 1; p.a = x + 2; return p; }
function f563(x: number): R { const p: R = new (G7 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f564(x: number): R { const p: R = new (F7 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f565(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f566(x: number): R { const p: R = new v7(x); p.b = x + 1; p.b = x + 2; return p; }
function f567(x: number): R { const p: R = new (G7 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f568(x: number): R { const p: R = new (F7 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f569(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f570(x: number): R { const p: R = new v7(x); p.b = x + 1; p.c = x + 2; return p; }
function f571(x: number): R { const p: R = new (G7 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f572(x: number): R { const p: R = new (F7 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f573(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f574(x: number): R { const p: R = new v7(x); p.b = x + 1; p.d = x + 2; return p; }
function f575(x: number): R { const p: R = new (G7 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f576(x: number): R { const p: R = new (F7 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f577(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f578(x: number): R { const p: R = new v7(x); p.c = x + 1; p.a = x + 2; return p; }
function f579(x: number): R { const p: R = new (G7 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f580(x: number): R { const p: R = new (F7 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f581(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f582(x: number): R { const p: R = new v7(x); p.c = x + 1; p.b = x + 2; return p; }
function f583(x: number): R { const p: R = new (G7 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f584(x: number): R { const p: R = new (F7 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f585(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f586(x: number): R { const p: R = new v7(x); p.c = x + 1; p.c = x + 2; return p; }
function f587(x: number): R { const p: R = new (G7 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f588(x: number): R { const p: R = new (F7 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f589(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f590(x: number): R { const p: R = new v7(x); p.c = x + 1; p.d = x + 2; return p; }
function f591(x: number): R { const p: R = new (G7 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f592(x: number): R { const p: R = new (F7 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f593(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f594(x: number): R { const p: R = new v7(x); p.d = x + 1; p.a = x + 2; return p; }
function f595(x: number): R { const p: R = new (G7 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f596(x: number): R { const p: R = new (F7 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f597(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f598(x: number): R { const p: R = new v7(x); p.d = x + 1; p.b = x + 2; return p; }
function f599(x: number): R { const p: R = new (G7 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f600(x: number): R { const p: R = new (F7 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f601(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f602(x: number): R { const p: R = new v7(x); p.d = x + 1; p.c = x + 2; return p; }
function f603(x: number): R { const p: R = new (G7 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f604(x: number): R { const p: R = new (F7 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f605(x: number): R { const p: R = new (F7 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f606(x: number): R { const p: R = new v7(x); p.d = x + 1; p.d = x + 2; return p; }
function f607(x: number): R { const p: R = new (G7 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f608(x: number): R { const p: R = new (F8 as any)(x); p.a = x + 1; return p; }
function f609(x: number): R { const p: R = new v8(x); p.a = x + 1; return p; }
function f610(x: number): R { const p: R = new (G8 as any)(x); p.a = x + 1; return p; }
function f611(x: number): R { const p: R = new (F8 as any)(x); p.b = x + 1; return p; }
function f612(x: number): R { const p: R = new v8(x); p.b = x + 1; return p; }
function f613(x: number): R { const p: R = new (G8 as any)(x); p.b = x + 1; return p; }
function f614(x: number): R { const p: R = new (F8 as any)(x); p.c = x + 1; return p; }
function f615(x: number): R { const p: R = new v8(x); p.c = x + 1; return p; }
function f616(x: number): R { const p: R = new (G8 as any)(x); p.c = x + 1; return p; }
function f617(x: number): R { const p: R = new (F8 as any)(x); p.d = x + 1; return p; }
function f618(x: number): R { const p: R = new v8(x); p.d = x + 1; return p; }
function f619(x: number): R { const p: R = new (G8 as any)(x); p.d = x + 1; return p; }
function f620(x: number): R { const p: R = new (F8 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f621(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f622(x: number): R { const p: R = new v8(x); p.a = x + 1; p.a = x + 2; return p; }
function f623(x: number): R { const p: R = new (G8 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f624(x: number): R { const p: R = new (F8 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f625(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f626(x: number): R { const p: R = new v8(x); p.a = x + 1; p.b = x + 2; return p; }
function f627(x: number): R { const p: R = new (G8 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f628(x: number): R { const p: R = new (F8 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f629(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f630(x: number): R { const p: R = new v8(x); p.a = x + 1; p.c = x + 2; return p; }
function f631(x: number): R { const p: R = new (G8 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f632(x: number): R { const p: R = new (F8 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f633(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f634(x: number): R { const p: R = new v8(x); p.a = x + 1; p.d = x + 2; return p; }
function f635(x: number): R { const p: R = new (G8 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f636(x: number): R { const p: R = new (F8 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f637(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f638(x: number): R { const p: R = new v8(x); p.b = x + 1; p.a = x + 2; return p; }
function f639(x: number): R { const p: R = new (G8 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f640(x: number): R { const p: R = new (F8 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f641(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f642(x: number): R { const p: R = new v8(x); p.b = x + 1; p.b = x + 2; return p; }
function f643(x: number): R { const p: R = new (G8 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f644(x: number): R { const p: R = new (F8 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f645(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f646(x: number): R { const p: R = new v8(x); p.b = x + 1; p.c = x + 2; return p; }
function f647(x: number): R { const p: R = new (G8 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f648(x: number): R { const p: R = new (F8 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f649(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f650(x: number): R { const p: R = new v8(x); p.b = x + 1; p.d = x + 2; return p; }
function f651(x: number): R { const p: R = new (G8 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f652(x: number): R { const p: R = new (F8 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f653(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f654(x: number): R { const p: R = new v8(x); p.c = x + 1; p.a = x + 2; return p; }
function f655(x: number): R { const p: R = new (G8 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f656(x: number): R { const p: R = new (F8 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f657(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f658(x: number): R { const p: R = new v8(x); p.c = x + 1; p.b = x + 2; return p; }
function f659(x: number): R { const p: R = new (G8 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f660(x: number): R { const p: R = new (F8 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f661(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f662(x: number): R { const p: R = new v8(x); p.c = x + 1; p.c = x + 2; return p; }
function f663(x: number): R { const p: R = new (G8 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f664(x: number): R { const p: R = new (F8 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f665(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f666(x: number): R { const p: R = new v8(x); p.c = x + 1; p.d = x + 2; return p; }
function f667(x: number): R { const p: R = new (G8 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f668(x: number): R { const p: R = new (F8 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f669(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f670(x: number): R { const p: R = new v8(x); p.d = x + 1; p.a = x + 2; return p; }
function f671(x: number): R { const p: R = new (G8 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f672(x: number): R { const p: R = new (F8 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f673(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f674(x: number): R { const p: R = new v8(x); p.d = x + 1; p.b = x + 2; return p; }
function f675(x: number): R { const p: R = new (G8 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f676(x: number): R { const p: R = new (F8 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f677(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f678(x: number): R { const p: R = new v8(x); p.d = x + 1; p.c = x + 2; return p; }
function f679(x: number): R { const p: R = new (G8 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f680(x: number): R { const p: R = new (F8 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f681(x: number): R { const p: R = new (F8 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f682(x: number): R { const p: R = new v8(x); p.d = x + 1; p.d = x + 2; return p; }
function f683(x: number): R { const p: R = new (G8 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f684(x: number): R { const p: R = new (F9 as any)(x); p.a = x + 1; return p; }
function f685(x: number): R { const p: R = new v9(x); p.a = x + 1; return p; }
function f686(x: number): R { const p: R = new (G9 as any)(x); p.a = x + 1; return p; }
function f687(x: number): R { const p: R = new (F9 as any)(x); p.b = x + 1; return p; }
function f688(x: number): R { const p: R = new v9(x); p.b = x + 1; return p; }
function f689(x: number): R { const p: R = new (G9 as any)(x); p.b = x + 1; return p; }
function f690(x: number): R { const p: R = new (F9 as any)(x); p.c = x + 1; return p; }
function f691(x: number): R { const p: R = new v9(x); p.c = x + 1; return p; }
function f692(x: number): R { const p: R = new (G9 as any)(x); p.c = x + 1; return p; }
function f693(x: number): R { const p: R = new (F9 as any)(x); p.d = x + 1; return p; }
function f694(x: number): R { const p: R = new v9(x); p.d = x + 1; return p; }
function f695(x: number): R { const p: R = new (G9 as any)(x); p.d = x + 1; return p; }
function f696(x: number): R { const p: R = new (F9 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f697(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f698(x: number): R { const p: R = new v9(x); p.a = x + 1; p.a = x + 2; return p; }
function f699(x: number): R { const p: R = new (G9 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f700(x: number): R { const p: R = new (F9 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f701(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f702(x: number): R { const p: R = new v9(x); p.a = x + 1; p.b = x + 2; return p; }
function f703(x: number): R { const p: R = new (G9 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f704(x: number): R { const p: R = new (F9 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f705(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f706(x: number): R { const p: R = new v9(x); p.a = x + 1; p.c = x + 2; return p; }
function f707(x: number): R { const p: R = new (G9 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f708(x: number): R { const p: R = new (F9 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f709(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f710(x: number): R { const p: R = new v9(x); p.a = x + 1; p.d = x + 2; return p; }
function f711(x: number): R { const p: R = new (G9 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f712(x: number): R { const p: R = new (F9 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f713(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f714(x: number): R { const p: R = new v9(x); p.b = x + 1; p.a = x + 2; return p; }
function f715(x: number): R { const p: R = new (G9 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f716(x: number): R { const p: R = new (F9 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f717(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f718(x: number): R { const p: R = new v9(x); p.b = x + 1; p.b = x + 2; return p; }
function f719(x: number): R { const p: R = new (G9 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f720(x: number): R { const p: R = new (F9 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f721(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f722(x: number): R { const p: R = new v9(x); p.b = x + 1; p.c = x + 2; return p; }
function f723(x: number): R { const p: R = new (G9 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f724(x: number): R { const p: R = new (F9 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f725(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f726(x: number): R { const p: R = new v9(x); p.b = x + 1; p.d = x + 2; return p; }
function f727(x: number): R { const p: R = new (G9 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f728(x: number): R { const p: R = new (F9 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f729(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f730(x: number): R { const p: R = new v9(x); p.c = x + 1; p.a = x + 2; return p; }
function f731(x: number): R { const p: R = new (G9 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f732(x: number): R { const p: R = new (F9 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f733(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f734(x: number): R { const p: R = new v9(x); p.c = x + 1; p.b = x + 2; return p; }
function f735(x: number): R { const p: R = new (G9 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f736(x: number): R { const p: R = new (F9 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f737(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f738(x: number): R { const p: R = new v9(x); p.c = x + 1; p.c = x + 2; return p; }
function f739(x: number): R { const p: R = new (G9 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f740(x: number): R { const p: R = new (F9 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f741(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f742(x: number): R { const p: R = new v9(x); p.c = x + 1; p.d = x + 2; return p; }
function f743(x: number): R { const p: R = new (G9 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f744(x: number): R { const p: R = new (F9 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f745(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f746(x: number): R { const p: R = new v9(x); p.d = x + 1; p.a = x + 2; return p; }
function f747(x: number): R { const p: R = new (G9 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f748(x: number): R { const p: R = new (F9 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f749(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f750(x: number): R { const p: R = new v9(x); p.d = x + 1; p.b = x + 2; return p; }
function f751(x: number): R { const p: R = new (G9 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f752(x: number): R { const p: R = new (F9 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f753(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f754(x: number): R { const p: R = new v9(x); p.d = x + 1; p.c = x + 2; return p; }
function f755(x: number): R { const p: R = new (G9 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f756(x: number): R { const p: R = new (F9 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f757(x: number): R { const p: R = new (F9 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f758(x: number): R { const p: R = new v9(x); p.d = x + 1; p.d = x + 2; return p; }
function f759(x: number): R { const p: R = new (G9 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f760(x: number): R { const p: R = new (F10 as any)(x); p.a = x + 1; return p; }
function f761(x: number): R { const p: R = new v10(x); p.a = x + 1; return p; }
function f762(x: number): R { const p: R = new (G10 as any)(x); p.a = x + 1; return p; }
function f763(x: number): R { const p: R = new (F10 as any)(x); p.b = x + 1; return p; }
function f764(x: number): R { const p: R = new v10(x); p.b = x + 1; return p; }
function f765(x: number): R { const p: R = new (G10 as any)(x); p.b = x + 1; return p; }
function f766(x: number): R { const p: R = new (F10 as any)(x); p.c = x + 1; return p; }
function f767(x: number): R { const p: R = new v10(x); p.c = x + 1; return p; }
function f768(x: number): R { const p: R = new (G10 as any)(x); p.c = x + 1; return p; }
function f769(x: number): R { const p: R = new (F10 as any)(x); p.d = x + 1; return p; }
function f770(x: number): R { const p: R = new v10(x); p.d = x + 1; return p; }
function f771(x: number): R { const p: R = new (G10 as any)(x); p.d = x + 1; return p; }
function f772(x: number): R { const p: R = new (F10 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f773(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f774(x: number): R { const p: R = new v10(x); p.a = x + 1; p.a = x + 2; return p; }
function f775(x: number): R { const p: R = new (G10 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f776(x: number): R { const p: R = new (F10 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f777(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f778(x: number): R { const p: R = new v10(x); p.a = x + 1; p.b = x + 2; return p; }
function f779(x: number): R { const p: R = new (G10 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f780(x: number): R { const p: R = new (F10 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f781(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f782(x: number): R { const p: R = new v10(x); p.a = x + 1; p.c = x + 2; return p; }
function f783(x: number): R { const p: R = new (G10 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f784(x: number): R { const p: R = new (F10 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f785(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f786(x: number): R { const p: R = new v10(x); p.a = x + 1; p.d = x + 2; return p; }
function f787(x: number): R { const p: R = new (G10 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f788(x: number): R { const p: R = new (F10 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f789(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f790(x: number): R { const p: R = new v10(x); p.b = x + 1; p.a = x + 2; return p; }
function f791(x: number): R { const p: R = new (G10 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f792(x: number): R { const p: R = new (F10 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f793(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f794(x: number): R { const p: R = new v10(x); p.b = x + 1; p.b = x + 2; return p; }
function f795(x: number): R { const p: R = new (G10 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f796(x: number): R { const p: R = new (F10 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f797(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f798(x: number): R { const p: R = new v10(x); p.b = x + 1; p.c = x + 2; return p; }
function f799(x: number): R { const p: R = new (G10 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f800(x: number): R { const p: R = new (F10 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f801(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f802(x: number): R { const p: R = new v10(x); p.b = x + 1; p.d = x + 2; return p; }
function f803(x: number): R { const p: R = new (G10 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f804(x: number): R { const p: R = new (F10 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f805(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f806(x: number): R { const p: R = new v10(x); p.c = x + 1; p.a = x + 2; return p; }
function f807(x: number): R { const p: R = new (G10 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f808(x: number): R { const p: R = new (F10 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f809(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f810(x: number): R { const p: R = new v10(x); p.c = x + 1; p.b = x + 2; return p; }
function f811(x: number): R { const p: R = new (G10 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f812(x: number): R { const p: R = new (F10 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f813(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f814(x: number): R { const p: R = new v10(x); p.c = x + 1; p.c = x + 2; return p; }
function f815(x: number): R { const p: R = new (G10 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f816(x: number): R { const p: R = new (F10 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f817(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f818(x: number): R { const p: R = new v10(x); p.c = x + 1; p.d = x + 2; return p; }
function f819(x: number): R { const p: R = new (G10 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f820(x: number): R { const p: R = new (F10 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f821(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f822(x: number): R { const p: R = new v10(x); p.d = x + 1; p.a = x + 2; return p; }
function f823(x: number): R { const p: R = new (G10 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f824(x: number): R { const p: R = new (F10 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f825(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f826(x: number): R { const p: R = new v10(x); p.d = x + 1; p.b = x + 2; return p; }
function f827(x: number): R { const p: R = new (G10 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f828(x: number): R { const p: R = new (F10 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f829(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f830(x: number): R { const p: R = new v10(x); p.d = x + 1; p.c = x + 2; return p; }
function f831(x: number): R { const p: R = new (G10 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f832(x: number): R { const p: R = new (F10 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f833(x: number): R { const p: R = new (F10 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f834(x: number): R { const p: R = new v10(x); p.d = x + 1; p.d = x + 2; return p; }
function f835(x: number): R { const p: R = new (G10 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f836(x: number): R { const p: R = new (F11 as any)(x); p.a = x + 1; return p; }
function f837(x: number): R { const p: R = new v11(x); p.a = x + 1; return p; }
function f838(x: number): R { const p: R = new (G11 as any)(x); p.a = x + 1; return p; }
function f839(x: number): R { const p: R = new (F11 as any)(x); p.b = x + 1; return p; }
function f840(x: number): R { const p: R = new v11(x); p.b = x + 1; return p; }
function f841(x: number): R { const p: R = new (G11 as any)(x); p.b = x + 1; return p; }
function f842(x: number): R { const p: R = new (F11 as any)(x); p.c = x + 1; return p; }
function f843(x: number): R { const p: R = new v11(x); p.c = x + 1; return p; }
function f844(x: number): R { const p: R = new (G11 as any)(x); p.c = x + 1; return p; }
function f845(x: number): R { const p: R = new (F11 as any)(x); p.d = x + 1; return p; }
function f846(x: number): R { const p: R = new v11(x); p.d = x + 1; return p; }
function f847(x: number): R { const p: R = new (G11 as any)(x); p.d = x + 1; return p; }
function f848(x: number): R { const p: R = new (F11 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f849(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f850(x: number): R { const p: R = new v11(x); p.a = x + 1; p.a = x + 2; return p; }
function f851(x: number): R { const p: R = new (G11 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f852(x: number): R { const p: R = new (F11 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f853(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f854(x: number): R { const p: R = new v11(x); p.a = x + 1; p.b = x + 2; return p; }
function f855(x: number): R { const p: R = new (G11 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f856(x: number): R { const p: R = new (F11 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f857(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f858(x: number): R { const p: R = new v11(x); p.a = x + 1; p.c = x + 2; return p; }
function f859(x: number): R { const p: R = new (G11 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f860(x: number): R { const p: R = new (F11 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f861(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f862(x: number): R { const p: R = new v11(x); p.a = x + 1; p.d = x + 2; return p; }
function f863(x: number): R { const p: R = new (G11 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f864(x: number): R { const p: R = new (F11 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f865(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f866(x: number): R { const p: R = new v11(x); p.b = x + 1; p.a = x + 2; return p; }
function f867(x: number): R { const p: R = new (G11 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f868(x: number): R { const p: R = new (F11 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f869(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f870(x: number): R { const p: R = new v11(x); p.b = x + 1; p.b = x + 2; return p; }
function f871(x: number): R { const p: R = new (G11 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f872(x: number): R { const p: R = new (F11 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f873(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f874(x: number): R { const p: R = new v11(x); p.b = x + 1; p.c = x + 2; return p; }
function f875(x: number): R { const p: R = new (G11 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f876(x: number): R { const p: R = new (F11 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f877(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f878(x: number): R { const p: R = new v11(x); p.b = x + 1; p.d = x + 2; return p; }
function f879(x: number): R { const p: R = new (G11 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f880(x: number): R { const p: R = new (F11 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f881(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f882(x: number): R { const p: R = new v11(x); p.c = x + 1; p.a = x + 2; return p; }
function f883(x: number): R { const p: R = new (G11 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f884(x: number): R { const p: R = new (F11 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f885(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f886(x: number): R { const p: R = new v11(x); p.c = x + 1; p.b = x + 2; return p; }
function f887(x: number): R { const p: R = new (G11 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f888(x: number): R { const p: R = new (F11 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f889(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f890(x: number): R { const p: R = new v11(x); p.c = x + 1; p.c = x + 2; return p; }
function f891(x: number): R { const p: R = new (G11 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f892(x: number): R { const p: R = new (F11 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f893(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f894(x: number): R { const p: R = new v11(x); p.c = x + 1; p.d = x + 2; return p; }
function f895(x: number): R { const p: R = new (G11 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f896(x: number): R { const p: R = new (F11 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f897(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f898(x: number): R { const p: R = new v11(x); p.d = x + 1; p.a = x + 2; return p; }
function f899(x: number): R { const p: R = new (G11 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f900(x: number): R { const p: R = new (F11 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f901(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f902(x: number): R { const p: R = new v11(x); p.d = x + 1; p.b = x + 2; return p; }
function f903(x: number): R { const p: R = new (G11 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f904(x: number): R { const p: R = new (F11 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f905(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f906(x: number): R { const p: R = new v11(x); p.d = x + 1; p.c = x + 2; return p; }
function f907(x: number): R { const p: R = new (G11 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f908(x: number): R { const p: R = new (F11 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f909(x: number): R { const p: R = new (F11 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f910(x: number): R { const p: R = new v11(x); p.d = x + 1; p.d = x + 2; return p; }
function f911(x: number): R { const p: R = new (G11 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f912(x: number): R { const p: R = new (F12 as any)(x); p.a = x + 1; return p; }
function f913(x: number): R { const p: R = new v12(x); p.a = x + 1; return p; }
function f914(x: number): R { const p: R = new (G12 as any)(x); p.a = x + 1; return p; }
function f915(x: number): R { const p: R = new (F12 as any)(x); p.b = x + 1; return p; }
function f916(x: number): R { const p: R = new v12(x); p.b = x + 1; return p; }
function f917(x: number): R { const p: R = new (G12 as any)(x); p.b = x + 1; return p; }
function f918(x: number): R { const p: R = new (F12 as any)(x); p.c = x + 1; return p; }
function f919(x: number): R { const p: R = new v12(x); p.c = x + 1; return p; }
function f920(x: number): R { const p: R = new (G12 as any)(x); p.c = x + 1; return p; }
function f921(x: number): R { const p: R = new (F12 as any)(x); p.d = x + 1; return p; }
function f922(x: number): R { const p: R = new v12(x); p.d = x + 1; return p; }
function f923(x: number): R { const p: R = new (G12 as any)(x); p.d = x + 1; return p; }
function f924(x: number): R { const p: R = new (F12 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f925(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f926(x: number): R { const p: R = new v12(x); p.a = x + 1; p.a = x + 2; return p; }
function f927(x: number): R { const p: R = new (G12 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f928(x: number): R { const p: R = new (F12 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f929(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f930(x: number): R { const p: R = new v12(x); p.a = x + 1; p.b = x + 2; return p; }
function f931(x: number): R { const p: R = new (G12 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f932(x: number): R { const p: R = new (F12 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f933(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f934(x: number): R { const p: R = new v12(x); p.a = x + 1; p.c = x + 2; return p; }
function f935(x: number): R { const p: R = new (G12 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f936(x: number): R { const p: R = new (F12 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f937(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f938(x: number): R { const p: R = new v12(x); p.a = x + 1; p.d = x + 2; return p; }
function f939(x: number): R { const p: R = new (G12 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f940(x: number): R { const p: R = new (F12 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f941(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f942(x: number): R { const p: R = new v12(x); p.b = x + 1; p.a = x + 2; return p; }
function f943(x: number): R { const p: R = new (G12 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f944(x: number): R { const p: R = new (F12 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f945(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f946(x: number): R { const p: R = new v12(x); p.b = x + 1; p.b = x + 2; return p; }
function f947(x: number): R { const p: R = new (G12 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f948(x: number): R { const p: R = new (F12 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f949(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f950(x: number): R { const p: R = new v12(x); p.b = x + 1; p.c = x + 2; return p; }
function f951(x: number): R { const p: R = new (G12 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f952(x: number): R { const p: R = new (F12 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f953(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f954(x: number): R { const p: R = new v12(x); p.b = x + 1; p.d = x + 2; return p; }
function f955(x: number): R { const p: R = new (G12 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f956(x: number): R { const p: R = new (F12 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f957(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f958(x: number): R { const p: R = new v12(x); p.c = x + 1; p.a = x + 2; return p; }
function f959(x: number): R { const p: R = new (G12 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f960(x: number): R { const p: R = new (F12 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f961(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f962(x: number): R { const p: R = new v12(x); p.c = x + 1; p.b = x + 2; return p; }
function f963(x: number): R { const p: R = new (G12 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f964(x: number): R { const p: R = new (F12 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f965(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f966(x: number): R { const p: R = new v12(x); p.c = x + 1; p.c = x + 2; return p; }
function f967(x: number): R { const p: R = new (G12 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f968(x: number): R { const p: R = new (F12 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f969(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f970(x: number): R { const p: R = new v12(x); p.c = x + 1; p.d = x + 2; return p; }
function f971(x: number): R { const p: R = new (G12 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f972(x: number): R { const p: R = new (F12 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f973(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f974(x: number): R { const p: R = new v12(x); p.d = x + 1; p.a = x + 2; return p; }
function f975(x: number): R { const p: R = new (G12 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f976(x: number): R { const p: R = new (F12 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f977(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f978(x: number): R { const p: R = new v12(x); p.d = x + 1; p.b = x + 2; return p; }
function f979(x: number): R { const p: R = new (G12 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f980(x: number): R { const p: R = new (F12 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f981(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f982(x: number): R { const p: R = new v12(x); p.d = x + 1; p.c = x + 2; return p; }
function f983(x: number): R { const p: R = new (G12 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f984(x: number): R { const p: R = new (F12 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f985(x: number): R { const p: R = new (F12 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f986(x: number): R { const p: R = new v12(x); p.d = x + 1; p.d = x + 2; return p; }
function f987(x: number): R { const p: R = new (G12 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f988(x: number): R { const p: R = new (F13 as any)(x); p.a = x + 1; return p; }
function f989(x: number): R { const p: R = new v13(x); p.a = x + 1; return p; }
function f990(x: number): R { const p: R = new (G13 as any)(x); p.a = x + 1; return p; }
function f991(x: number): R { const p: R = new (F13 as any)(x); p.b = x + 1; return p; }
function f992(x: number): R { const p: R = new v13(x); p.b = x + 1; return p; }
function f993(x: number): R { const p: R = new (G13 as any)(x); p.b = x + 1; return p; }
function f994(x: number): R { const p: R = new (F13 as any)(x); p.c = x + 1; return p; }
function f995(x: number): R { const p: R = new v13(x); p.c = x + 1; return p; }
function f996(x: number): R { const p: R = new (G13 as any)(x); p.c = x + 1; return p; }
function f997(x: number): R { const p: R = new (F13 as any)(x); p.d = x + 1; return p; }
function f998(x: number): R { const p: R = new v13(x); p.d = x + 1; return p; }
function f999(x: number): R { const p: R = new (G13 as any)(x); p.d = x + 1; return p; }
function f1000(x: number): R { const p: R = new (F13 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1001(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1002(x: number): R { const p: R = new v13(x); p.a = x + 1; p.a = x + 2; return p; }
function f1003(x: number): R { const p: R = new (G13 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1004(x: number): R { const p: R = new (F13 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1005(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1006(x: number): R { const p: R = new v13(x); p.a = x + 1; p.b = x + 2; return p; }
function f1007(x: number): R { const p: R = new (G13 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1008(x: number): R { const p: R = new (F13 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1009(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1010(x: number): R { const p: R = new v13(x); p.a = x + 1; p.c = x + 2; return p; }
function f1011(x: number): R { const p: R = new (G13 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1012(x: number): R { const p: R = new (F13 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1013(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1014(x: number): R { const p: R = new v13(x); p.a = x + 1; p.d = x + 2; return p; }
function f1015(x: number): R { const p: R = new (G13 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1016(x: number): R { const p: R = new (F13 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1017(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1018(x: number): R { const p: R = new v13(x); p.b = x + 1; p.a = x + 2; return p; }
function f1019(x: number): R { const p: R = new (G13 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1020(x: number): R { const p: R = new (F13 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1021(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1022(x: number): R { const p: R = new v13(x); p.b = x + 1; p.b = x + 2; return p; }
function f1023(x: number): R { const p: R = new (G13 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1024(x: number): R { const p: R = new (F13 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1025(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1026(x: number): R { const p: R = new v13(x); p.b = x + 1; p.c = x + 2; return p; }
function f1027(x: number): R { const p: R = new (G13 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1028(x: number): R { const p: R = new (F13 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1029(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1030(x: number): R { const p: R = new v13(x); p.b = x + 1; p.d = x + 2; return p; }
function f1031(x: number): R { const p: R = new (G13 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1032(x: number): R { const p: R = new (F13 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1033(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1034(x: number): R { const p: R = new v13(x); p.c = x + 1; p.a = x + 2; return p; }
function f1035(x: number): R { const p: R = new (G13 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1036(x: number): R { const p: R = new (F13 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1037(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1038(x: number): R { const p: R = new v13(x); p.c = x + 1; p.b = x + 2; return p; }
function f1039(x: number): R { const p: R = new (G13 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1040(x: number): R { const p: R = new (F13 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1041(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1042(x: number): R { const p: R = new v13(x); p.c = x + 1; p.c = x + 2; return p; }
function f1043(x: number): R { const p: R = new (G13 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1044(x: number): R { const p: R = new (F13 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1045(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1046(x: number): R { const p: R = new v13(x); p.c = x + 1; p.d = x + 2; return p; }
function f1047(x: number): R { const p: R = new (G13 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1048(x: number): R { const p: R = new (F13 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1049(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1050(x: number): R { const p: R = new v13(x); p.d = x + 1; p.a = x + 2; return p; }
function f1051(x: number): R { const p: R = new (G13 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1052(x: number): R { const p: R = new (F13 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1053(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1054(x: number): R { const p: R = new v13(x); p.d = x + 1; p.b = x + 2; return p; }
function f1055(x: number): R { const p: R = new (G13 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1056(x: number): R { const p: R = new (F13 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1057(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1058(x: number): R { const p: R = new v13(x); p.d = x + 1; p.c = x + 2; return p; }
function f1059(x: number): R { const p: R = new (G13 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1060(x: number): R { const p: R = new (F13 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1061(x: number): R { const p: R = new (F13 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1062(x: number): R { const p: R = new v13(x); p.d = x + 1; p.d = x + 2; return p; }
function f1063(x: number): R { const p: R = new (G13 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1064(x: number): R { const p: R = new (F14 as any)(x); p.a = x + 1; return p; }
function f1065(x: number): R { const p: R = new v14(x); p.a = x + 1; return p; }
function f1066(x: number): R { const p: R = new (G14 as any)(x); p.a = x + 1; return p; }
function f1067(x: number): R { const p: R = new (F14 as any)(x); p.b = x + 1; return p; }
function f1068(x: number): R { const p: R = new v14(x); p.b = x + 1; return p; }
function f1069(x: number): R { const p: R = new (G14 as any)(x); p.b = x + 1; return p; }
function f1070(x: number): R { const p: R = new (F14 as any)(x); p.c = x + 1; return p; }
function f1071(x: number): R { const p: R = new v14(x); p.c = x + 1; return p; }
function f1072(x: number): R { const p: R = new (G14 as any)(x); p.c = x + 1; return p; }
function f1073(x: number): R { const p: R = new (F14 as any)(x); p.d = x + 1; return p; }
function f1074(x: number): R { const p: R = new v14(x); p.d = x + 1; return p; }
function f1075(x: number): R { const p: R = new (G14 as any)(x); p.d = x + 1; return p; }
function f1076(x: number): R { const p: R = new (F14 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1077(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1078(x: number): R { const p: R = new v14(x); p.a = x + 1; p.a = x + 2; return p; }
function f1079(x: number): R { const p: R = new (G14 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1080(x: number): R { const p: R = new (F14 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1081(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1082(x: number): R { const p: R = new v14(x); p.a = x + 1; p.b = x + 2; return p; }
function f1083(x: number): R { const p: R = new (G14 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1084(x: number): R { const p: R = new (F14 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1085(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1086(x: number): R { const p: R = new v14(x); p.a = x + 1; p.c = x + 2; return p; }
function f1087(x: number): R { const p: R = new (G14 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1088(x: number): R { const p: R = new (F14 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1089(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1090(x: number): R { const p: R = new v14(x); p.a = x + 1; p.d = x + 2; return p; }
function f1091(x: number): R { const p: R = new (G14 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1092(x: number): R { const p: R = new (F14 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1093(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1094(x: number): R { const p: R = new v14(x); p.b = x + 1; p.a = x + 2; return p; }
function f1095(x: number): R { const p: R = new (G14 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1096(x: number): R { const p: R = new (F14 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1097(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1098(x: number): R { const p: R = new v14(x); p.b = x + 1; p.b = x + 2; return p; }
function f1099(x: number): R { const p: R = new (G14 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1100(x: number): R { const p: R = new (F14 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1101(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1102(x: number): R { const p: R = new v14(x); p.b = x + 1; p.c = x + 2; return p; }
function f1103(x: number): R { const p: R = new (G14 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1104(x: number): R { const p: R = new (F14 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1105(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1106(x: number): R { const p: R = new v14(x); p.b = x + 1; p.d = x + 2; return p; }
function f1107(x: number): R { const p: R = new (G14 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1108(x: number): R { const p: R = new (F14 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1109(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1110(x: number): R { const p: R = new v14(x); p.c = x + 1; p.a = x + 2; return p; }
function f1111(x: number): R { const p: R = new (G14 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1112(x: number): R { const p: R = new (F14 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1113(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1114(x: number): R { const p: R = new v14(x); p.c = x + 1; p.b = x + 2; return p; }
function f1115(x: number): R { const p: R = new (G14 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1116(x: number): R { const p: R = new (F14 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1117(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1118(x: number): R { const p: R = new v14(x); p.c = x + 1; p.c = x + 2; return p; }
function f1119(x: number): R { const p: R = new (G14 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1120(x: number): R { const p: R = new (F14 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1121(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1122(x: number): R { const p: R = new v14(x); p.c = x + 1; p.d = x + 2; return p; }
function f1123(x: number): R { const p: R = new (G14 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1124(x: number): R { const p: R = new (F14 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1125(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1126(x: number): R { const p: R = new v14(x); p.d = x + 1; p.a = x + 2; return p; }
function f1127(x: number): R { const p: R = new (G14 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1128(x: number): R { const p: R = new (F14 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1129(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1130(x: number): R { const p: R = new v14(x); p.d = x + 1; p.b = x + 2; return p; }
function f1131(x: number): R { const p: R = new (G14 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1132(x: number): R { const p: R = new (F14 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1133(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1134(x: number): R { const p: R = new v14(x); p.d = x + 1; p.c = x + 2; return p; }
function f1135(x: number): R { const p: R = new (G14 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1136(x: number): R { const p: R = new (F14 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1137(x: number): R { const p: R = new (F14 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1138(x: number): R { const p: R = new v14(x); p.d = x + 1; p.d = x + 2; return p; }
function f1139(x: number): R { const p: R = new (G14 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1140(x: number): R { const p: R = new (F15 as any)(x); p.a = x + 1; return p; }
function f1141(x: number): R { const p: R = new v15(x); p.a = x + 1; return p; }
function f1142(x: number): R { const p: R = new (G15 as any)(x); p.a = x + 1; return p; }
function f1143(x: number): R { const p: R = new (F15 as any)(x); p.b = x + 1; return p; }
function f1144(x: number): R { const p: R = new v15(x); p.b = x + 1; return p; }
function f1145(x: number): R { const p: R = new (G15 as any)(x); p.b = x + 1; return p; }
function f1146(x: number): R { const p: R = new (F15 as any)(x); p.c = x + 1; return p; }
function f1147(x: number): R { const p: R = new v15(x); p.c = x + 1; return p; }
function f1148(x: number): R { const p: R = new (G15 as any)(x); p.c = x + 1; return p; }
function f1149(x: number): R { const p: R = new (F15 as any)(x); p.d = x + 1; return p; }
function f1150(x: number): R { const p: R = new v15(x); p.d = x + 1; return p; }
function f1151(x: number): R { const p: R = new (G15 as any)(x); p.d = x + 1; return p; }
function f1152(x: number): R { const p: R = new (F15 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1153(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1154(x: number): R { const p: R = new v15(x); p.a = x + 1; p.a = x + 2; return p; }
function f1155(x: number): R { const p: R = new (G15 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1156(x: number): R { const p: R = new (F15 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1157(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1158(x: number): R { const p: R = new v15(x); p.a = x + 1; p.b = x + 2; return p; }
function f1159(x: number): R { const p: R = new (G15 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1160(x: number): R { const p: R = new (F15 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1161(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1162(x: number): R { const p: R = new v15(x); p.a = x + 1; p.c = x + 2; return p; }
function f1163(x: number): R { const p: R = new (G15 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1164(x: number): R { const p: R = new (F15 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1165(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1166(x: number): R { const p: R = new v15(x); p.a = x + 1; p.d = x + 2; return p; }
function f1167(x: number): R { const p: R = new (G15 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1168(x: number): R { const p: R = new (F15 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1169(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1170(x: number): R { const p: R = new v15(x); p.b = x + 1; p.a = x + 2; return p; }
function f1171(x: number): R { const p: R = new (G15 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1172(x: number): R { const p: R = new (F15 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1173(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1174(x: number): R { const p: R = new v15(x); p.b = x + 1; p.b = x + 2; return p; }
function f1175(x: number): R { const p: R = new (G15 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1176(x: number): R { const p: R = new (F15 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1177(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1178(x: number): R { const p: R = new v15(x); p.b = x + 1; p.c = x + 2; return p; }
function f1179(x: number): R { const p: R = new (G15 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1180(x: number): R { const p: R = new (F15 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1181(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1182(x: number): R { const p: R = new v15(x); p.b = x + 1; p.d = x + 2; return p; }
function f1183(x: number): R { const p: R = new (G15 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1184(x: number): R { const p: R = new (F15 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1185(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1186(x: number): R { const p: R = new v15(x); p.c = x + 1; p.a = x + 2; return p; }
function f1187(x: number): R { const p: R = new (G15 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1188(x: number): R { const p: R = new (F15 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1189(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1190(x: number): R { const p: R = new v15(x); p.c = x + 1; p.b = x + 2; return p; }
function f1191(x: number): R { const p: R = new (G15 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1192(x: number): R { const p: R = new (F15 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1193(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1194(x: number): R { const p: R = new v15(x); p.c = x + 1; p.c = x + 2; return p; }
function f1195(x: number): R { const p: R = new (G15 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1196(x: number): R { const p: R = new (F15 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1197(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1198(x: number): R { const p: R = new v15(x); p.c = x + 1; p.d = x + 2; return p; }
function f1199(x: number): R { const p: R = new (G15 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1200(x: number): R { const p: R = new (F15 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1201(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1202(x: number): R { const p: R = new v15(x); p.d = x + 1; p.a = x + 2; return p; }
function f1203(x: number): R { const p: R = new (G15 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1204(x: number): R { const p: R = new (F15 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1205(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1206(x: number): R { const p: R = new v15(x); p.d = x + 1; p.b = x + 2; return p; }
function f1207(x: number): R { const p: R = new (G15 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1208(x: number): R { const p: R = new (F15 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1209(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1210(x: number): R { const p: R = new v15(x); p.d = x + 1; p.c = x + 2; return p; }
function f1211(x: number): R { const p: R = new (G15 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1212(x: number): R { const p: R = new (F15 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1213(x: number): R { const p: R = new (F15 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1214(x: number): R { const p: R = new v15(x); p.d = x + 1; p.d = x + 2; return p; }
function f1215(x: number): R { const p: R = new (G15 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1216(x: number): R { const p: R = new (F16 as any)(x); p.a = x + 1; return p; }
function f1217(x: number): R { const p: R = new v16(x); p.a = x + 1; return p; }
function f1218(x: number): R { const p: R = new (G16 as any)(x); p.a = x + 1; return p; }
function f1219(x: number): R { const p: R = new (F16 as any)(x); p.b = x + 1; return p; }
function f1220(x: number): R { const p: R = new v16(x); p.b = x + 1; return p; }
function f1221(x: number): R { const p: R = new (G16 as any)(x); p.b = x + 1; return p; }
function f1222(x: number): R { const p: R = new (F16 as any)(x); p.c = x + 1; return p; }
function f1223(x: number): R { const p: R = new v16(x); p.c = x + 1; return p; }
function f1224(x: number): R { const p: R = new (G16 as any)(x); p.c = x + 1; return p; }
function f1225(x: number): R { const p: R = new (F16 as any)(x); p.d = x + 1; return p; }
function f1226(x: number): R { const p: R = new v16(x); p.d = x + 1; return p; }
function f1227(x: number): R { const p: R = new (G16 as any)(x); p.d = x + 1; return p; }
function f1228(x: number): R { const p: R = new (F16 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1229(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1230(x: number): R { const p: R = new v16(x); p.a = x + 1; p.a = x + 2; return p; }
function f1231(x: number): R { const p: R = new (G16 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1232(x: number): R { const p: R = new (F16 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1233(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1234(x: number): R { const p: R = new v16(x); p.a = x + 1; p.b = x + 2; return p; }
function f1235(x: number): R { const p: R = new (G16 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1236(x: number): R { const p: R = new (F16 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1237(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1238(x: number): R { const p: R = new v16(x); p.a = x + 1; p.c = x + 2; return p; }
function f1239(x: number): R { const p: R = new (G16 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1240(x: number): R { const p: R = new (F16 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1241(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1242(x: number): R { const p: R = new v16(x); p.a = x + 1; p.d = x + 2; return p; }
function f1243(x: number): R { const p: R = new (G16 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1244(x: number): R { const p: R = new (F16 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1245(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1246(x: number): R { const p: R = new v16(x); p.b = x + 1; p.a = x + 2; return p; }
function f1247(x: number): R { const p: R = new (G16 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1248(x: number): R { const p: R = new (F16 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1249(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1250(x: number): R { const p: R = new v16(x); p.b = x + 1; p.b = x + 2; return p; }
function f1251(x: number): R { const p: R = new (G16 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1252(x: number): R { const p: R = new (F16 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1253(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1254(x: number): R { const p: R = new v16(x); p.b = x + 1; p.c = x + 2; return p; }
function f1255(x: number): R { const p: R = new (G16 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1256(x: number): R { const p: R = new (F16 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1257(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1258(x: number): R { const p: R = new v16(x); p.b = x + 1; p.d = x + 2; return p; }
function f1259(x: number): R { const p: R = new (G16 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1260(x: number): R { const p: R = new (F16 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1261(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1262(x: number): R { const p: R = new v16(x); p.c = x + 1; p.a = x + 2; return p; }
function f1263(x: number): R { const p: R = new (G16 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1264(x: number): R { const p: R = new (F16 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1265(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1266(x: number): R { const p: R = new v16(x); p.c = x + 1; p.b = x + 2; return p; }
function f1267(x: number): R { const p: R = new (G16 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1268(x: number): R { const p: R = new (F16 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1269(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1270(x: number): R { const p: R = new v16(x); p.c = x + 1; p.c = x + 2; return p; }
function f1271(x: number): R { const p: R = new (G16 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1272(x: number): R { const p: R = new (F16 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1273(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1274(x: number): R { const p: R = new v16(x); p.c = x + 1; p.d = x + 2; return p; }
function f1275(x: number): R { const p: R = new (G16 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1276(x: number): R { const p: R = new (F16 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1277(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1278(x: number): R { const p: R = new v16(x); p.d = x + 1; p.a = x + 2; return p; }
function f1279(x: number): R { const p: R = new (G16 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1280(x: number): R { const p: R = new (F16 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1281(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1282(x: number): R { const p: R = new v16(x); p.d = x + 1; p.b = x + 2; return p; }
function f1283(x: number): R { const p: R = new (G16 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1284(x: number): R { const p: R = new (F16 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1285(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1286(x: number): R { const p: R = new v16(x); p.d = x + 1; p.c = x + 2; return p; }
function f1287(x: number): R { const p: R = new (G16 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1288(x: number): R { const p: R = new (F16 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1289(x: number): R { const p: R = new (F16 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1290(x: number): R { const p: R = new v16(x); p.d = x + 1; p.d = x + 2; return p; }
function f1291(x: number): R { const p: R = new (G16 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1292(x: number): R { const p: R = new (F17 as any)(x); p.a = x + 1; return p; }
function f1293(x: number): R { const p: R = new v17(x); p.a = x + 1; return p; }
function f1294(x: number): R { const p: R = new (G17 as any)(x); p.a = x + 1; return p; }
function f1295(x: number): R { const p: R = new (F17 as any)(x); p.b = x + 1; return p; }
function f1296(x: number): R { const p: R = new v17(x); p.b = x + 1; return p; }
function f1297(x: number): R { const p: R = new (G17 as any)(x); p.b = x + 1; return p; }
function f1298(x: number): R { const p: R = new (F17 as any)(x); p.c = x + 1; return p; }
function f1299(x: number): R { const p: R = new v17(x); p.c = x + 1; return p; }
function f1300(x: number): R { const p: R = new (G17 as any)(x); p.c = x + 1; return p; }
function f1301(x: number): R { const p: R = new (F17 as any)(x); p.d = x + 1; return p; }
function f1302(x: number): R { const p: R = new v17(x); p.d = x + 1; return p; }
function f1303(x: number): R { const p: R = new (G17 as any)(x); p.d = x + 1; return p; }
function f1304(x: number): R { const p: R = new (F17 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1305(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1306(x: number): R { const p: R = new v17(x); p.a = x + 1; p.a = x + 2; return p; }
function f1307(x: number): R { const p: R = new (G17 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1308(x: number): R { const p: R = new (F17 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1309(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1310(x: number): R { const p: R = new v17(x); p.a = x + 1; p.b = x + 2; return p; }
function f1311(x: number): R { const p: R = new (G17 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1312(x: number): R { const p: R = new (F17 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1313(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1314(x: number): R { const p: R = new v17(x); p.a = x + 1; p.c = x + 2; return p; }
function f1315(x: number): R { const p: R = new (G17 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1316(x: number): R { const p: R = new (F17 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1317(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1318(x: number): R { const p: R = new v17(x); p.a = x + 1; p.d = x + 2; return p; }
function f1319(x: number): R { const p: R = new (G17 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1320(x: number): R { const p: R = new (F17 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1321(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1322(x: number): R { const p: R = new v17(x); p.b = x + 1; p.a = x + 2; return p; }
function f1323(x: number): R { const p: R = new (G17 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1324(x: number): R { const p: R = new (F17 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1325(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1326(x: number): R { const p: R = new v17(x); p.b = x + 1; p.b = x + 2; return p; }
function f1327(x: number): R { const p: R = new (G17 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1328(x: number): R { const p: R = new (F17 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1329(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1330(x: number): R { const p: R = new v17(x); p.b = x + 1; p.c = x + 2; return p; }
function f1331(x: number): R { const p: R = new (G17 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1332(x: number): R { const p: R = new (F17 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1333(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1334(x: number): R { const p: R = new v17(x); p.b = x + 1; p.d = x + 2; return p; }
function f1335(x: number): R { const p: R = new (G17 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1336(x: number): R { const p: R = new (F17 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1337(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1338(x: number): R { const p: R = new v17(x); p.c = x + 1; p.a = x + 2; return p; }
function f1339(x: number): R { const p: R = new (G17 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1340(x: number): R { const p: R = new (F17 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1341(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1342(x: number): R { const p: R = new v17(x); p.c = x + 1; p.b = x + 2; return p; }
function f1343(x: number): R { const p: R = new (G17 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1344(x: number): R { const p: R = new (F17 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1345(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1346(x: number): R { const p: R = new v17(x); p.c = x + 1; p.c = x + 2; return p; }
function f1347(x: number): R { const p: R = new (G17 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1348(x: number): R { const p: R = new (F17 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1349(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1350(x: number): R { const p: R = new v17(x); p.c = x + 1; p.d = x + 2; return p; }
function f1351(x: number): R { const p: R = new (G17 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1352(x: number): R { const p: R = new (F17 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1353(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1354(x: number): R { const p: R = new v17(x); p.d = x + 1; p.a = x + 2; return p; }
function f1355(x: number): R { const p: R = new (G17 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1356(x: number): R { const p: R = new (F17 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1357(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1358(x: number): R { const p: R = new v17(x); p.d = x + 1; p.b = x + 2; return p; }
function f1359(x: number): R { const p: R = new (G17 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1360(x: number): R { const p: R = new (F17 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1361(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1362(x: number): R { const p: R = new v17(x); p.d = x + 1; p.c = x + 2; return p; }
function f1363(x: number): R { const p: R = new (G17 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1364(x: number): R { const p: R = new (F17 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1365(x: number): R { const p: R = new (F17 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1366(x: number): R { const p: R = new v17(x); p.d = x + 1; p.d = x + 2; return p; }
function f1367(x: number): R { const p: R = new (G17 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1368(x: number): R { const p: R = new (F18 as any)(x); p.a = x + 1; return p; }
function f1369(x: number): R { const p: R = new v18(x); p.a = x + 1; return p; }
function f1370(x: number): R { const p: R = new (G18 as any)(x); p.a = x + 1; return p; }
function f1371(x: number): R { const p: R = new (F18 as any)(x); p.b = x + 1; return p; }
function f1372(x: number): R { const p: R = new v18(x); p.b = x + 1; return p; }
function f1373(x: number): R { const p: R = new (G18 as any)(x); p.b = x + 1; return p; }
function f1374(x: number): R { const p: R = new (F18 as any)(x); p.c = x + 1; return p; }
function f1375(x: number): R { const p: R = new v18(x); p.c = x + 1; return p; }
function f1376(x: number): R { const p: R = new (G18 as any)(x); p.c = x + 1; return p; }
function f1377(x: number): R { const p: R = new (F18 as any)(x); p.d = x + 1; return p; }
function f1378(x: number): R { const p: R = new v18(x); p.d = x + 1; return p; }
function f1379(x: number): R { const p: R = new (G18 as any)(x); p.d = x + 1; return p; }
function f1380(x: number): R { const p: R = new (F18 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1381(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1382(x: number): R { const p: R = new v18(x); p.a = x + 1; p.a = x + 2; return p; }
function f1383(x: number): R { const p: R = new (G18 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1384(x: number): R { const p: R = new (F18 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1385(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1386(x: number): R { const p: R = new v18(x); p.a = x + 1; p.b = x + 2; return p; }
function f1387(x: number): R { const p: R = new (G18 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1388(x: number): R { const p: R = new (F18 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1389(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1390(x: number): R { const p: R = new v18(x); p.a = x + 1; p.c = x + 2; return p; }
function f1391(x: number): R { const p: R = new (G18 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1392(x: number): R { const p: R = new (F18 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1393(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1394(x: number): R { const p: R = new v18(x); p.a = x + 1; p.d = x + 2; return p; }
function f1395(x: number): R { const p: R = new (G18 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1396(x: number): R { const p: R = new (F18 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1397(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1398(x: number): R { const p: R = new v18(x); p.b = x + 1; p.a = x + 2; return p; }
function f1399(x: number): R { const p: R = new (G18 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1400(x: number): R { const p: R = new (F18 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1401(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1402(x: number): R { const p: R = new v18(x); p.b = x + 1; p.b = x + 2; return p; }
function f1403(x: number): R { const p: R = new (G18 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1404(x: number): R { const p: R = new (F18 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1405(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1406(x: number): R { const p: R = new v18(x); p.b = x + 1; p.c = x + 2; return p; }
function f1407(x: number): R { const p: R = new (G18 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1408(x: number): R { const p: R = new (F18 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1409(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1410(x: number): R { const p: R = new v18(x); p.b = x + 1; p.d = x + 2; return p; }
function f1411(x: number): R { const p: R = new (G18 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1412(x: number): R { const p: R = new (F18 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1413(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1414(x: number): R { const p: R = new v18(x); p.c = x + 1; p.a = x + 2; return p; }
function f1415(x: number): R { const p: R = new (G18 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1416(x: number): R { const p: R = new (F18 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1417(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1418(x: number): R { const p: R = new v18(x); p.c = x + 1; p.b = x + 2; return p; }
function f1419(x: number): R { const p: R = new (G18 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1420(x: number): R { const p: R = new (F18 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1421(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1422(x: number): R { const p: R = new v18(x); p.c = x + 1; p.c = x + 2; return p; }
function f1423(x: number): R { const p: R = new (G18 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1424(x: number): R { const p: R = new (F18 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1425(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1426(x: number): R { const p: R = new v18(x); p.c = x + 1; p.d = x + 2; return p; }
function f1427(x: number): R { const p: R = new (G18 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1428(x: number): R { const p: R = new (F18 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1429(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1430(x: number): R { const p: R = new v18(x); p.d = x + 1; p.a = x + 2; return p; }
function f1431(x: number): R { const p: R = new (G18 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1432(x: number): R { const p: R = new (F18 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1433(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1434(x: number): R { const p: R = new v18(x); p.d = x + 1; p.b = x + 2; return p; }
function f1435(x: number): R { const p: R = new (G18 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1436(x: number): R { const p: R = new (F18 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1437(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1438(x: number): R { const p: R = new v18(x); p.d = x + 1; p.c = x + 2; return p; }
function f1439(x: number): R { const p: R = new (G18 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1440(x: number): R { const p: R = new (F18 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1441(x: number): R { const p: R = new (F18 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1442(x: number): R { const p: R = new v18(x); p.d = x + 1; p.d = x + 2; return p; }
function f1443(x: number): R { const p: R = new (G18 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1444(x: number): R { const p: R = new (F19 as any)(x); p.a = x + 1; return p; }
function f1445(x: number): R { const p: R = new v19(x); p.a = x + 1; return p; }
function f1446(x: number): R { const p: R = new (G19 as any)(x); p.a = x + 1; return p; }
function f1447(x: number): R { const p: R = new (F19 as any)(x); p.b = x + 1; return p; }
function f1448(x: number): R { const p: R = new v19(x); p.b = x + 1; return p; }
function f1449(x: number): R { const p: R = new (G19 as any)(x); p.b = x + 1; return p; }
function f1450(x: number): R { const p: R = new (F19 as any)(x); p.c = x + 1; return p; }
function f1451(x: number): R { const p: R = new v19(x); p.c = x + 1; return p; }
function f1452(x: number): R { const p: R = new (G19 as any)(x); p.c = x + 1; return p; }
function f1453(x: number): R { const p: R = new (F19 as any)(x); p.d = x + 1; return p; }
function f1454(x: number): R { const p: R = new v19(x); p.d = x + 1; return p; }
function f1455(x: number): R { const p: R = new (G19 as any)(x); p.d = x + 1; return p; }
function f1456(x: number): R { const p: R = new (F19 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1457(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1458(x: number): R { const p: R = new v19(x); p.a = x + 1; p.a = x + 2; return p; }
function f1459(x: number): R { const p: R = new (G19 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1460(x: number): R { const p: R = new (F19 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1461(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1462(x: number): R { const p: R = new v19(x); p.a = x + 1; p.b = x + 2; return p; }
function f1463(x: number): R { const p: R = new (G19 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1464(x: number): R { const p: R = new (F19 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1465(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1466(x: number): R { const p: R = new v19(x); p.a = x + 1; p.c = x + 2; return p; }
function f1467(x: number): R { const p: R = new (G19 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1468(x: number): R { const p: R = new (F19 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1469(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1470(x: number): R { const p: R = new v19(x); p.a = x + 1; p.d = x + 2; return p; }
function f1471(x: number): R { const p: R = new (G19 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1472(x: number): R { const p: R = new (F19 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1473(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1474(x: number): R { const p: R = new v19(x); p.b = x + 1; p.a = x + 2; return p; }
function f1475(x: number): R { const p: R = new (G19 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1476(x: number): R { const p: R = new (F19 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1477(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1478(x: number): R { const p: R = new v19(x); p.b = x + 1; p.b = x + 2; return p; }
function f1479(x: number): R { const p: R = new (G19 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1480(x: number): R { const p: R = new (F19 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1481(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1482(x: number): R { const p: R = new v19(x); p.b = x + 1; p.c = x + 2; return p; }
function f1483(x: number): R { const p: R = new (G19 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1484(x: number): R { const p: R = new (F19 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1485(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1486(x: number): R { const p: R = new v19(x); p.b = x + 1; p.d = x + 2; return p; }
function f1487(x: number): R { const p: R = new (G19 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1488(x: number): R { const p: R = new (F19 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1489(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1490(x: number): R { const p: R = new v19(x); p.c = x + 1; p.a = x + 2; return p; }
function f1491(x: number): R { const p: R = new (G19 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1492(x: number): R { const p: R = new (F19 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1493(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1494(x: number): R { const p: R = new v19(x); p.c = x + 1; p.b = x + 2; return p; }
function f1495(x: number): R { const p: R = new (G19 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1496(x: number): R { const p: R = new (F19 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1497(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1498(x: number): R { const p: R = new v19(x); p.c = x + 1; p.c = x + 2; return p; }
function f1499(x: number): R { const p: R = new (G19 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1500(x: number): R { const p: R = new (F19 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1501(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1502(x: number): R { const p: R = new v19(x); p.c = x + 1; p.d = x + 2; return p; }
function f1503(x: number): R { const p: R = new (G19 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1504(x: number): R { const p: R = new (F19 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1505(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1506(x: number): R { const p: R = new v19(x); p.d = x + 1; p.a = x + 2; return p; }
function f1507(x: number): R { const p: R = new (G19 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1508(x: number): R { const p: R = new (F19 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1509(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1510(x: number): R { const p: R = new v19(x); p.d = x + 1; p.b = x + 2; return p; }
function f1511(x: number): R { const p: R = new (G19 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1512(x: number): R { const p: R = new (F19 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1513(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1514(x: number): R { const p: R = new v19(x); p.d = x + 1; p.c = x + 2; return p; }
function f1515(x: number): R { const p: R = new (G19 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1516(x: number): R { const p: R = new (F19 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1517(x: number): R { const p: R = new (F19 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1518(x: number): R { const p: R = new v19(x); p.d = x + 1; p.d = x + 2; return p; }
function f1519(x: number): R { const p: R = new (G19 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1520(x: number): R { const p: R = new (F20 as any)(x); p.a = x + 1; return p; }
function f1521(x: number): R { const p: R = new v20(x); p.a = x + 1; return p; }
function f1522(x: number): R { const p: R = new (G20 as any)(x); p.a = x + 1; return p; }
function f1523(x: number): R { const p: R = new (F20 as any)(x); p.b = x + 1; return p; }
function f1524(x: number): R { const p: R = new v20(x); p.b = x + 1; return p; }
function f1525(x: number): R { const p: R = new (G20 as any)(x); p.b = x + 1; return p; }
function f1526(x: number): R { const p: R = new (F20 as any)(x); p.c = x + 1; return p; }
function f1527(x: number): R { const p: R = new v20(x); p.c = x + 1; return p; }
function f1528(x: number): R { const p: R = new (G20 as any)(x); p.c = x + 1; return p; }
function f1529(x: number): R { const p: R = new (F20 as any)(x); p.d = x + 1; return p; }
function f1530(x: number): R { const p: R = new v20(x); p.d = x + 1; return p; }
function f1531(x: number): R { const p: R = new (G20 as any)(x); p.d = x + 1; return p; }
function f1532(x: number): R { const p: R = new (F20 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1533(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1534(x: number): R { const p: R = new v20(x); p.a = x + 1; p.a = x + 2; return p; }
function f1535(x: number): R { const p: R = new (G20 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1536(x: number): R { const p: R = new (F20 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1537(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1538(x: number): R { const p: R = new v20(x); p.a = x + 1; p.b = x + 2; return p; }
function f1539(x: number): R { const p: R = new (G20 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1540(x: number): R { const p: R = new (F20 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1541(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1542(x: number): R { const p: R = new v20(x); p.a = x + 1; p.c = x + 2; return p; }
function f1543(x: number): R { const p: R = new (G20 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1544(x: number): R { const p: R = new (F20 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1545(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1546(x: number): R { const p: R = new v20(x); p.a = x + 1; p.d = x + 2; return p; }
function f1547(x: number): R { const p: R = new (G20 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1548(x: number): R { const p: R = new (F20 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1549(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1550(x: number): R { const p: R = new v20(x); p.b = x + 1; p.a = x + 2; return p; }
function f1551(x: number): R { const p: R = new (G20 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1552(x: number): R { const p: R = new (F20 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1553(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1554(x: number): R { const p: R = new v20(x); p.b = x + 1; p.b = x + 2; return p; }
function f1555(x: number): R { const p: R = new (G20 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1556(x: number): R { const p: R = new (F20 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1557(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1558(x: number): R { const p: R = new v20(x); p.b = x + 1; p.c = x + 2; return p; }
function f1559(x: number): R { const p: R = new (G20 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1560(x: number): R { const p: R = new (F20 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1561(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1562(x: number): R { const p: R = new v20(x); p.b = x + 1; p.d = x + 2; return p; }
function f1563(x: number): R { const p: R = new (G20 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1564(x: number): R { const p: R = new (F20 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1565(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1566(x: number): R { const p: R = new v20(x); p.c = x + 1; p.a = x + 2; return p; }
function f1567(x: number): R { const p: R = new (G20 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1568(x: number): R { const p: R = new (F20 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1569(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1570(x: number): R { const p: R = new v20(x); p.c = x + 1; p.b = x + 2; return p; }
function f1571(x: number): R { const p: R = new (G20 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1572(x: number): R { const p: R = new (F20 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1573(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1574(x: number): R { const p: R = new v20(x); p.c = x + 1; p.c = x + 2; return p; }
function f1575(x: number): R { const p: R = new (G20 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1576(x: number): R { const p: R = new (F20 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1577(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1578(x: number): R { const p: R = new v20(x); p.c = x + 1; p.d = x + 2; return p; }
function f1579(x: number): R { const p: R = new (G20 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1580(x: number): R { const p: R = new (F20 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1581(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1582(x: number): R { const p: R = new v20(x); p.d = x + 1; p.a = x + 2; return p; }
function f1583(x: number): R { const p: R = new (G20 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1584(x: number): R { const p: R = new (F20 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1585(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1586(x: number): R { const p: R = new v20(x); p.d = x + 1; p.b = x + 2; return p; }
function f1587(x: number): R { const p: R = new (G20 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1588(x: number): R { const p: R = new (F20 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1589(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1590(x: number): R { const p: R = new v20(x); p.d = x + 1; p.c = x + 2; return p; }
function f1591(x: number): R { const p: R = new (G20 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1592(x: number): R { const p: R = new (F20 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1593(x: number): R { const p: R = new (F20 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1594(x: number): R { const p: R = new v20(x); p.d = x + 1; p.d = x + 2; return p; }
function f1595(x: number): R { const p: R = new (G20 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1596(x: number): R { const p: R = new (F21 as any)(x); p.a = x + 1; return p; }
function f1597(x: number): R { const p: R = new v21(x); p.a = x + 1; return p; }
function f1598(x: number): R { const p: R = new (G21 as any)(x); p.a = x + 1; return p; }
function f1599(x: number): R { const p: R = new (F21 as any)(x); p.b = x + 1; return p; }
function f1600(x: number): R { const p: R = new v21(x); p.b = x + 1; return p; }
function f1601(x: number): R { const p: R = new (G21 as any)(x); p.b = x + 1; return p; }
function f1602(x: number): R { const p: R = new (F21 as any)(x); p.c = x + 1; return p; }
function f1603(x: number): R { const p: R = new v21(x); p.c = x + 1; return p; }
function f1604(x: number): R { const p: R = new (G21 as any)(x); p.c = x + 1; return p; }
function f1605(x: number): R { const p: R = new (F21 as any)(x); p.d = x + 1; return p; }
function f1606(x: number): R { const p: R = new v21(x); p.d = x + 1; return p; }
function f1607(x: number): R { const p: R = new (G21 as any)(x); p.d = x + 1; return p; }
function f1608(x: number): R { const p: R = new (F21 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1609(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1610(x: number): R { const p: R = new v21(x); p.a = x + 1; p.a = x + 2; return p; }
function f1611(x: number): R { const p: R = new (G21 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1612(x: number): R { const p: R = new (F21 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1613(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1614(x: number): R { const p: R = new v21(x); p.a = x + 1; p.b = x + 2; return p; }
function f1615(x: number): R { const p: R = new (G21 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1616(x: number): R { const p: R = new (F21 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1617(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1618(x: number): R { const p: R = new v21(x); p.a = x + 1; p.c = x + 2; return p; }
function f1619(x: number): R { const p: R = new (G21 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1620(x: number): R { const p: R = new (F21 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1621(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1622(x: number): R { const p: R = new v21(x); p.a = x + 1; p.d = x + 2; return p; }
function f1623(x: number): R { const p: R = new (G21 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1624(x: number): R { const p: R = new (F21 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1625(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1626(x: number): R { const p: R = new v21(x); p.b = x + 1; p.a = x + 2; return p; }
function f1627(x: number): R { const p: R = new (G21 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1628(x: number): R { const p: R = new (F21 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1629(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1630(x: number): R { const p: R = new v21(x); p.b = x + 1; p.b = x + 2; return p; }
function f1631(x: number): R { const p: R = new (G21 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1632(x: number): R { const p: R = new (F21 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1633(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1634(x: number): R { const p: R = new v21(x); p.b = x + 1; p.c = x + 2; return p; }
function f1635(x: number): R { const p: R = new (G21 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1636(x: number): R { const p: R = new (F21 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1637(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1638(x: number): R { const p: R = new v21(x); p.b = x + 1; p.d = x + 2; return p; }
function f1639(x: number): R { const p: R = new (G21 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1640(x: number): R { const p: R = new (F21 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1641(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1642(x: number): R { const p: R = new v21(x); p.c = x + 1; p.a = x + 2; return p; }
function f1643(x: number): R { const p: R = new (G21 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1644(x: number): R { const p: R = new (F21 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1645(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1646(x: number): R { const p: R = new v21(x); p.c = x + 1; p.b = x + 2; return p; }
function f1647(x: number): R { const p: R = new (G21 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1648(x: number): R { const p: R = new (F21 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1649(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1650(x: number): R { const p: R = new v21(x); p.c = x + 1; p.c = x + 2; return p; }
function f1651(x: number): R { const p: R = new (G21 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1652(x: number): R { const p: R = new (F21 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1653(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1654(x: number): R { const p: R = new v21(x); p.c = x + 1; p.d = x + 2; return p; }
function f1655(x: number): R { const p: R = new (G21 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1656(x: number): R { const p: R = new (F21 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1657(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1658(x: number): R { const p: R = new v21(x); p.d = x + 1; p.a = x + 2; return p; }
function f1659(x: number): R { const p: R = new (G21 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1660(x: number): R { const p: R = new (F21 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1661(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1662(x: number): R { const p: R = new v21(x); p.d = x + 1; p.b = x + 2; return p; }
function f1663(x: number): R { const p: R = new (G21 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1664(x: number): R { const p: R = new (F21 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1665(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1666(x: number): R { const p: R = new v21(x); p.d = x + 1; p.c = x + 2; return p; }
function f1667(x: number): R { const p: R = new (G21 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1668(x: number): R { const p: R = new (F21 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1669(x: number): R { const p: R = new (F21 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1670(x: number): R { const p: R = new v21(x); p.d = x + 1; p.d = x + 2; return p; }
function f1671(x: number): R { const p: R = new (G21 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1672(x: number): R { const p: R = new (F22 as any)(x); p.a = x + 1; return p; }
function f1673(x: number): R { const p: R = new v22(x); p.a = x + 1; return p; }
function f1674(x: number): R { const p: R = new (G22 as any)(x); p.a = x + 1; return p; }
function f1675(x: number): R { const p: R = new (F22 as any)(x); p.b = x + 1; return p; }
function f1676(x: number): R { const p: R = new v22(x); p.b = x + 1; return p; }
function f1677(x: number): R { const p: R = new (G22 as any)(x); p.b = x + 1; return p; }
function f1678(x: number): R { const p: R = new (F22 as any)(x); p.c = x + 1; return p; }
function f1679(x: number): R { const p: R = new v22(x); p.c = x + 1; return p; }
function f1680(x: number): R { const p: R = new (G22 as any)(x); p.c = x + 1; return p; }
function f1681(x: number): R { const p: R = new (F22 as any)(x); p.d = x + 1; return p; }
function f1682(x: number): R { const p: R = new v22(x); p.d = x + 1; return p; }
function f1683(x: number): R { const p: R = new (G22 as any)(x); p.d = x + 1; return p; }
function f1684(x: number): R { const p: R = new (F22 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1685(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1686(x: number): R { const p: R = new v22(x); p.a = x + 1; p.a = x + 2; return p; }
function f1687(x: number): R { const p: R = new (G22 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1688(x: number): R { const p: R = new (F22 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1689(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1690(x: number): R { const p: R = new v22(x); p.a = x + 1; p.b = x + 2; return p; }
function f1691(x: number): R { const p: R = new (G22 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1692(x: number): R { const p: R = new (F22 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1693(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1694(x: number): R { const p: R = new v22(x); p.a = x + 1; p.c = x + 2; return p; }
function f1695(x: number): R { const p: R = new (G22 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1696(x: number): R { const p: R = new (F22 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1697(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1698(x: number): R { const p: R = new v22(x); p.a = x + 1; p.d = x + 2; return p; }
function f1699(x: number): R { const p: R = new (G22 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1700(x: number): R { const p: R = new (F22 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1701(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1702(x: number): R { const p: R = new v22(x); p.b = x + 1; p.a = x + 2; return p; }
function f1703(x: number): R { const p: R = new (G22 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1704(x: number): R { const p: R = new (F22 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1705(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1706(x: number): R { const p: R = new v22(x); p.b = x + 1; p.b = x + 2; return p; }
function f1707(x: number): R { const p: R = new (G22 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1708(x: number): R { const p: R = new (F22 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1709(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1710(x: number): R { const p: R = new v22(x); p.b = x + 1; p.c = x + 2; return p; }
function f1711(x: number): R { const p: R = new (G22 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1712(x: number): R { const p: R = new (F22 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1713(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1714(x: number): R { const p: R = new v22(x); p.b = x + 1; p.d = x + 2; return p; }
function f1715(x: number): R { const p: R = new (G22 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1716(x: number): R { const p: R = new (F22 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1717(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1718(x: number): R { const p: R = new v22(x); p.c = x + 1; p.a = x + 2; return p; }
function f1719(x: number): R { const p: R = new (G22 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1720(x: number): R { const p: R = new (F22 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1721(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1722(x: number): R { const p: R = new v22(x); p.c = x + 1; p.b = x + 2; return p; }
function f1723(x: number): R { const p: R = new (G22 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1724(x: number): R { const p: R = new (F22 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1725(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1726(x: number): R { const p: R = new v22(x); p.c = x + 1; p.c = x + 2; return p; }
function f1727(x: number): R { const p: R = new (G22 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1728(x: number): R { const p: R = new (F22 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1729(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1730(x: number): R { const p: R = new v22(x); p.c = x + 1; p.d = x + 2; return p; }
function f1731(x: number): R { const p: R = new (G22 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1732(x: number): R { const p: R = new (F22 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1733(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1734(x: number): R { const p: R = new v22(x); p.d = x + 1; p.a = x + 2; return p; }
function f1735(x: number): R { const p: R = new (G22 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1736(x: number): R { const p: R = new (F22 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1737(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1738(x: number): R { const p: R = new v22(x); p.d = x + 1; p.b = x + 2; return p; }
function f1739(x: number): R { const p: R = new (G22 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1740(x: number): R { const p: R = new (F22 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1741(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1742(x: number): R { const p: R = new v22(x); p.d = x + 1; p.c = x + 2; return p; }
function f1743(x: number): R { const p: R = new (G22 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1744(x: number): R { const p: R = new (F22 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1745(x: number): R { const p: R = new (F22 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1746(x: number): R { const p: R = new v22(x); p.d = x + 1; p.d = x + 2; return p; }
function f1747(x: number): R { const p: R = new (G22 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1748(x: number): R { const p: R = new (F23 as any)(x); p.a = x + 1; return p; }
function f1749(x: number): R { const p: R = new v23(x); p.a = x + 1; return p; }
function f1750(x: number): R { const p: R = new (G23 as any)(x); p.a = x + 1; return p; }
function f1751(x: number): R { const p: R = new (F23 as any)(x); p.b = x + 1; return p; }
function f1752(x: number): R { const p: R = new v23(x); p.b = x + 1; return p; }
function f1753(x: number): R { const p: R = new (G23 as any)(x); p.b = x + 1; return p; }
function f1754(x: number): R { const p: R = new (F23 as any)(x); p.c = x + 1; return p; }
function f1755(x: number): R { const p: R = new v23(x); p.c = x + 1; return p; }
function f1756(x: number): R { const p: R = new (G23 as any)(x); p.c = x + 1; return p; }
function f1757(x: number): R { const p: R = new (F23 as any)(x); p.d = x + 1; return p; }
function f1758(x: number): R { const p: R = new v23(x); p.d = x + 1; return p; }
function f1759(x: number): R { const p: R = new (G23 as any)(x); p.d = x + 1; return p; }
function f1760(x: number): R { const p: R = new (F23 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1761(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1762(x: number): R { const p: R = new v23(x); p.a = x + 1; p.a = x + 2; return p; }
function f1763(x: number): R { const p: R = new (G23 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1764(x: number): R { const p: R = new (F23 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1765(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1766(x: number): R { const p: R = new v23(x); p.a = x + 1; p.b = x + 2; return p; }
function f1767(x: number): R { const p: R = new (G23 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1768(x: number): R { const p: R = new (F23 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1769(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1770(x: number): R { const p: R = new v23(x); p.a = x + 1; p.c = x + 2; return p; }
function f1771(x: number): R { const p: R = new (G23 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1772(x: number): R { const p: R = new (F23 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1773(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1774(x: number): R { const p: R = new v23(x); p.a = x + 1; p.d = x + 2; return p; }
function f1775(x: number): R { const p: R = new (G23 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1776(x: number): R { const p: R = new (F23 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1777(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1778(x: number): R { const p: R = new v23(x); p.b = x + 1; p.a = x + 2; return p; }
function f1779(x: number): R { const p: R = new (G23 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1780(x: number): R { const p: R = new (F23 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1781(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1782(x: number): R { const p: R = new v23(x); p.b = x + 1; p.b = x + 2; return p; }
function f1783(x: number): R { const p: R = new (G23 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1784(x: number): R { const p: R = new (F23 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1785(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1786(x: number): R { const p: R = new v23(x); p.b = x + 1; p.c = x + 2; return p; }
function f1787(x: number): R { const p: R = new (G23 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1788(x: number): R { const p: R = new (F23 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1789(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1790(x: number): R { const p: R = new v23(x); p.b = x + 1; p.d = x + 2; return p; }
function f1791(x: number): R { const p: R = new (G23 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1792(x: number): R { const p: R = new (F23 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1793(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1794(x: number): R { const p: R = new v23(x); p.c = x + 1; p.a = x + 2; return p; }
function f1795(x: number): R { const p: R = new (G23 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1796(x: number): R { const p: R = new (F23 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1797(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1798(x: number): R { const p: R = new v23(x); p.c = x + 1; p.b = x + 2; return p; }
function f1799(x: number): R { const p: R = new (G23 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1800(x: number): R { const p: R = new (F23 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1801(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1802(x: number): R { const p: R = new v23(x); p.c = x + 1; p.c = x + 2; return p; }
function f1803(x: number): R { const p: R = new (G23 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1804(x: number): R { const p: R = new (F23 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1805(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1806(x: number): R { const p: R = new v23(x); p.c = x + 1; p.d = x + 2; return p; }
function f1807(x: number): R { const p: R = new (G23 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1808(x: number): R { const p: R = new (F23 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1809(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1810(x: number): R { const p: R = new v23(x); p.d = x + 1; p.a = x + 2; return p; }
function f1811(x: number): R { const p: R = new (G23 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1812(x: number): R { const p: R = new (F23 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1813(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1814(x: number): R { const p: R = new v23(x); p.d = x + 1; p.b = x + 2; return p; }
function f1815(x: number): R { const p: R = new (G23 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1816(x: number): R { const p: R = new (F23 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1817(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1818(x: number): R { const p: R = new v23(x); p.d = x + 1; p.c = x + 2; return p; }
function f1819(x: number): R { const p: R = new (G23 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1820(x: number): R { const p: R = new (F23 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1821(x: number): R { const p: R = new (F23 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1822(x: number): R { const p: R = new v23(x); p.d = x + 1; p.d = x + 2; return p; }
function f1823(x: number): R { const p: R = new (G23 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1824(x: number): R { const p: R = new (F24 as any)(x); p.a = x + 1; return p; }
function f1825(x: number): R { const p: R = new v24(x); p.a = x + 1; return p; }
function f1826(x: number): R { const p: R = new (G24 as any)(x); p.a = x + 1; return p; }
function f1827(x: number): R { const p: R = new (F24 as any)(x); p.b = x + 1; return p; }
function f1828(x: number): R { const p: R = new v24(x); p.b = x + 1; return p; }
function f1829(x: number): R { const p: R = new (G24 as any)(x); p.b = x + 1; return p; }
function f1830(x: number): R { const p: R = new (F24 as any)(x); p.c = x + 1; return p; }
function f1831(x: number): R { const p: R = new v24(x); p.c = x + 1; return p; }
function f1832(x: number): R { const p: R = new (G24 as any)(x); p.c = x + 1; return p; }
function f1833(x: number): R { const p: R = new (F24 as any)(x); p.d = x + 1; return p; }
function f1834(x: number): R { const p: R = new v24(x); p.d = x + 1; return p; }
function f1835(x: number): R { const p: R = new (G24 as any)(x); p.d = x + 1; return p; }
function f1836(x: number): R { const p: R = new (F24 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1837(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1838(x: number): R { const p: R = new v24(x); p.a = x + 1; p.a = x + 2; return p; }
function f1839(x: number): R { const p: R = new (G24 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1840(x: number): R { const p: R = new (F24 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1841(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1842(x: number): R { const p: R = new v24(x); p.a = x + 1; p.b = x + 2; return p; }
function f1843(x: number): R { const p: R = new (G24 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1844(x: number): R { const p: R = new (F24 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1845(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1846(x: number): R { const p: R = new v24(x); p.a = x + 1; p.c = x + 2; return p; }
function f1847(x: number): R { const p: R = new (G24 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1848(x: number): R { const p: R = new (F24 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1849(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1850(x: number): R { const p: R = new v24(x); p.a = x + 1; p.d = x + 2; return p; }
function f1851(x: number): R { const p: R = new (G24 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1852(x: number): R { const p: R = new (F24 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1853(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1854(x: number): R { const p: R = new v24(x); p.b = x + 1; p.a = x + 2; return p; }
function f1855(x: number): R { const p: R = new (G24 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1856(x: number): R { const p: R = new (F24 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1857(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1858(x: number): R { const p: R = new v24(x); p.b = x + 1; p.b = x + 2; return p; }
function f1859(x: number): R { const p: R = new (G24 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1860(x: number): R { const p: R = new (F24 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1861(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1862(x: number): R { const p: R = new v24(x); p.b = x + 1; p.c = x + 2; return p; }
function f1863(x: number): R { const p: R = new (G24 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1864(x: number): R { const p: R = new (F24 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1865(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1866(x: number): R { const p: R = new v24(x); p.b = x + 1; p.d = x + 2; return p; }
function f1867(x: number): R { const p: R = new (G24 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1868(x: number): R { const p: R = new (F24 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1869(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1870(x: number): R { const p: R = new v24(x); p.c = x + 1; p.a = x + 2; return p; }
function f1871(x: number): R { const p: R = new (G24 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1872(x: number): R { const p: R = new (F24 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1873(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1874(x: number): R { const p: R = new v24(x); p.c = x + 1; p.b = x + 2; return p; }
function f1875(x: number): R { const p: R = new (G24 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1876(x: number): R { const p: R = new (F24 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1877(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1878(x: number): R { const p: R = new v24(x); p.c = x + 1; p.c = x + 2; return p; }
function f1879(x: number): R { const p: R = new (G24 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1880(x: number): R { const p: R = new (F24 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1881(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1882(x: number): R { const p: R = new v24(x); p.c = x + 1; p.d = x + 2; return p; }
function f1883(x: number): R { const p: R = new (G24 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1884(x: number): R { const p: R = new (F24 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1885(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1886(x: number): R { const p: R = new v24(x); p.d = x + 1; p.a = x + 2; return p; }
function f1887(x: number): R { const p: R = new (G24 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1888(x: number): R { const p: R = new (F24 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1889(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1890(x: number): R { const p: R = new v24(x); p.d = x + 1; p.b = x + 2; return p; }
function f1891(x: number): R { const p: R = new (G24 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1892(x: number): R { const p: R = new (F24 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1893(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1894(x: number): R { const p: R = new v24(x); p.d = x + 1; p.c = x + 2; return p; }
function f1895(x: number): R { const p: R = new (G24 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1896(x: number): R { const p: R = new (F24 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1897(x: number): R { const p: R = new (F24 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1898(x: number): R { const p: R = new v24(x); p.d = x + 1; p.d = x + 2; return p; }
function f1899(x: number): R { const p: R = new (G24 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1900(x: number): R { const p: R = new (F25 as any)(x); p.a = x + 1; return p; }
function f1901(x: number): R { const p: R = new v25(x); p.a = x + 1; return p; }
function f1902(x: number): R { const p: R = new (G25 as any)(x); p.a = x + 1; return p; }
function f1903(x: number): R { const p: R = new (F25 as any)(x); p.b = x + 1; return p; }
function f1904(x: number): R { const p: R = new v25(x); p.b = x + 1; return p; }
function f1905(x: number): R { const p: R = new (G25 as any)(x); p.b = x + 1; return p; }
function f1906(x: number): R { const p: R = new (F25 as any)(x); p.c = x + 1; return p; }
function f1907(x: number): R { const p: R = new v25(x); p.c = x + 1; return p; }
function f1908(x: number): R { const p: R = new (G25 as any)(x); p.c = x + 1; return p; }
function f1909(x: number): R { const p: R = new (F25 as any)(x); p.d = x + 1; return p; }
function f1910(x: number): R { const p: R = new v25(x); p.d = x + 1; return p; }
function f1911(x: number): R { const p: R = new (G25 as any)(x); p.d = x + 1; return p; }
function f1912(x: number): R { const p: R = new (F25 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1913(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1914(x: number): R { const p: R = new v25(x); p.a = x + 1; p.a = x + 2; return p; }
function f1915(x: number): R { const p: R = new (G25 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1916(x: number): R { const p: R = new (F25 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1917(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1918(x: number): R { const p: R = new v25(x); p.a = x + 1; p.b = x + 2; return p; }
function f1919(x: number): R { const p: R = new (G25 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1920(x: number): R { const p: R = new (F25 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1921(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1922(x: number): R { const p: R = new v25(x); p.a = x + 1; p.c = x + 2; return p; }
function f1923(x: number): R { const p: R = new (G25 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1924(x: number): R { const p: R = new (F25 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1925(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f1926(x: number): R { const p: R = new v25(x); p.a = x + 1; p.d = x + 2; return p; }
function f1927(x: number): R { const p: R = new (G25 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f1928(x: number): R { const p: R = new (F25 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1929(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f1930(x: number): R { const p: R = new v25(x); p.b = x + 1; p.a = x + 2; return p; }
function f1931(x: number): R { const p: R = new (G25 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f1932(x: number): R { const p: R = new (F25 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1933(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f1934(x: number): R { const p: R = new v25(x); p.b = x + 1; p.b = x + 2; return p; }
function f1935(x: number): R { const p: R = new (G25 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f1936(x: number): R { const p: R = new (F25 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1937(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f1938(x: number): R { const p: R = new v25(x); p.b = x + 1; p.c = x + 2; return p; }
function f1939(x: number): R { const p: R = new (G25 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f1940(x: number): R { const p: R = new (F25 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1941(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f1942(x: number): R { const p: R = new v25(x); p.b = x + 1; p.d = x + 2; return p; }
function f1943(x: number): R { const p: R = new (G25 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f1944(x: number): R { const p: R = new (F25 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1945(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f1946(x: number): R { const p: R = new v25(x); p.c = x + 1; p.a = x + 2; return p; }
function f1947(x: number): R { const p: R = new (G25 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f1948(x: number): R { const p: R = new (F25 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1949(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f1950(x: number): R { const p: R = new v25(x); p.c = x + 1; p.b = x + 2; return p; }
function f1951(x: number): R { const p: R = new (G25 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f1952(x: number): R { const p: R = new (F25 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1953(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f1954(x: number): R { const p: R = new v25(x); p.c = x + 1; p.c = x + 2; return p; }
function f1955(x: number): R { const p: R = new (G25 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f1956(x: number): R { const p: R = new (F25 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1957(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f1958(x: number): R { const p: R = new v25(x); p.c = x + 1; p.d = x + 2; return p; }
function f1959(x: number): R { const p: R = new (G25 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f1960(x: number): R { const p: R = new (F25 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1961(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f1962(x: number): R { const p: R = new v25(x); p.d = x + 1; p.a = x + 2; return p; }
function f1963(x: number): R { const p: R = new (G25 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f1964(x: number): R { const p: R = new (F25 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1965(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f1966(x: number): R { const p: R = new v25(x); p.d = x + 1; p.b = x + 2; return p; }
function f1967(x: number): R { const p: R = new (G25 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f1968(x: number): R { const p: R = new (F25 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1969(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f1970(x: number): R { const p: R = new v25(x); p.d = x + 1; p.c = x + 2; return p; }
function f1971(x: number): R { const p: R = new (G25 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f1972(x: number): R { const p: R = new (F25 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1973(x: number): R { const p: R = new (F25 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f1974(x: number): R { const p: R = new v25(x); p.d = x + 1; p.d = x + 2; return p; }
function f1975(x: number): R { const p: R = new (G25 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f1976(x: number): R { const p: R = new (F26 as any)(x); p.a = x + 1; return p; }
function f1977(x: number): R { const p: R = new v26(x); p.a = x + 1; return p; }
function f1978(x: number): R { const p: R = new (G26 as any)(x); p.a = x + 1; return p; }
function f1979(x: number): R { const p: R = new (F26 as any)(x); p.b = x + 1; return p; }
function f1980(x: number): R { const p: R = new v26(x); p.b = x + 1; return p; }
function f1981(x: number): R { const p: R = new (G26 as any)(x); p.b = x + 1; return p; }
function f1982(x: number): R { const p: R = new (F26 as any)(x); p.c = x + 1; return p; }
function f1983(x: number): R { const p: R = new v26(x); p.c = x + 1; return p; }
function f1984(x: number): R { const p: R = new (G26 as any)(x); p.c = x + 1; return p; }
function f1985(x: number): R { const p: R = new (F26 as any)(x); p.d = x + 1; return p; }
function f1986(x: number): R { const p: R = new v26(x); p.d = x + 1; return p; }
function f1987(x: number): R { const p: R = new (G26 as any)(x); p.d = x + 1; return p; }
function f1988(x: number): R { const p: R = new (F26 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1989(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f1990(x: number): R { const p: R = new v26(x); p.a = x + 1; p.a = x + 2; return p; }
function f1991(x: number): R { const p: R = new (G26 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f1992(x: number): R { const p: R = new (F26 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1993(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f1994(x: number): R { const p: R = new v26(x); p.a = x + 1; p.b = x + 2; return p; }
function f1995(x: number): R { const p: R = new (G26 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f1996(x: number): R { const p: R = new (F26 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f1997(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f1998(x: number): R { const p: R = new v26(x); p.a = x + 1; p.c = x + 2; return p; }
function f1999(x: number): R { const p: R = new (G26 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2000(x: number): R { const p: R = new (F26 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2001(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2002(x: number): R { const p: R = new v26(x); p.a = x + 1; p.d = x + 2; return p; }
function f2003(x: number): R { const p: R = new (G26 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2004(x: number): R { const p: R = new (F26 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2005(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2006(x: number): R { const p: R = new v26(x); p.b = x + 1; p.a = x + 2; return p; }
function f2007(x: number): R { const p: R = new (G26 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2008(x: number): R { const p: R = new (F26 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2009(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2010(x: number): R { const p: R = new v26(x); p.b = x + 1; p.b = x + 2; return p; }
function f2011(x: number): R { const p: R = new (G26 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2012(x: number): R { const p: R = new (F26 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2013(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2014(x: number): R { const p: R = new v26(x); p.b = x + 1; p.c = x + 2; return p; }
function f2015(x: number): R { const p: R = new (G26 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2016(x: number): R { const p: R = new (F26 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2017(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2018(x: number): R { const p: R = new v26(x); p.b = x + 1; p.d = x + 2; return p; }
function f2019(x: number): R { const p: R = new (G26 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2020(x: number): R { const p: R = new (F26 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2021(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2022(x: number): R { const p: R = new v26(x); p.c = x + 1; p.a = x + 2; return p; }
function f2023(x: number): R { const p: R = new (G26 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2024(x: number): R { const p: R = new (F26 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2025(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2026(x: number): R { const p: R = new v26(x); p.c = x + 1; p.b = x + 2; return p; }
function f2027(x: number): R { const p: R = new (G26 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2028(x: number): R { const p: R = new (F26 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2029(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2030(x: number): R { const p: R = new v26(x); p.c = x + 1; p.c = x + 2; return p; }
function f2031(x: number): R { const p: R = new (G26 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2032(x: number): R { const p: R = new (F26 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2033(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2034(x: number): R { const p: R = new v26(x); p.c = x + 1; p.d = x + 2; return p; }
function f2035(x: number): R { const p: R = new (G26 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2036(x: number): R { const p: R = new (F26 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2037(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2038(x: number): R { const p: R = new v26(x); p.d = x + 1; p.a = x + 2; return p; }
function f2039(x: number): R { const p: R = new (G26 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2040(x: number): R { const p: R = new (F26 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2041(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2042(x: number): R { const p: R = new v26(x); p.d = x + 1; p.b = x + 2; return p; }
function f2043(x: number): R { const p: R = new (G26 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2044(x: number): R { const p: R = new (F26 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2045(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2046(x: number): R { const p: R = new v26(x); p.d = x + 1; p.c = x + 2; return p; }
function f2047(x: number): R { const p: R = new (G26 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2048(x: number): R { const p: R = new (F26 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2049(x: number): R { const p: R = new (F26 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2050(x: number): R { const p: R = new v26(x); p.d = x + 1; p.d = x + 2; return p; }
function f2051(x: number): R { const p: R = new (G26 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2052(x: number): R { const p: R = new (F27 as any)(x); p.a = x + 1; return p; }
function f2053(x: number): R { const p: R = new v27(x); p.a = x + 1; return p; }
function f2054(x: number): R { const p: R = new (G27 as any)(x); p.a = x + 1; return p; }
function f2055(x: number): R { const p: R = new (F27 as any)(x); p.b = x + 1; return p; }
function f2056(x: number): R { const p: R = new v27(x); p.b = x + 1; return p; }
function f2057(x: number): R { const p: R = new (G27 as any)(x); p.b = x + 1; return p; }
function f2058(x: number): R { const p: R = new (F27 as any)(x); p.c = x + 1; return p; }
function f2059(x: number): R { const p: R = new v27(x); p.c = x + 1; return p; }
function f2060(x: number): R { const p: R = new (G27 as any)(x); p.c = x + 1; return p; }
function f2061(x: number): R { const p: R = new (F27 as any)(x); p.d = x + 1; return p; }
function f2062(x: number): R { const p: R = new v27(x); p.d = x + 1; return p; }
function f2063(x: number): R { const p: R = new (G27 as any)(x); p.d = x + 1; return p; }
function f2064(x: number): R { const p: R = new (F27 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2065(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2066(x: number): R { const p: R = new v27(x); p.a = x + 1; p.a = x + 2; return p; }
function f2067(x: number): R { const p: R = new (G27 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2068(x: number): R { const p: R = new (F27 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2069(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2070(x: number): R { const p: R = new v27(x); p.a = x + 1; p.b = x + 2; return p; }
function f2071(x: number): R { const p: R = new (G27 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2072(x: number): R { const p: R = new (F27 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2073(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2074(x: number): R { const p: R = new v27(x); p.a = x + 1; p.c = x + 2; return p; }
function f2075(x: number): R { const p: R = new (G27 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2076(x: number): R { const p: R = new (F27 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2077(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2078(x: number): R { const p: R = new v27(x); p.a = x + 1; p.d = x + 2; return p; }
function f2079(x: number): R { const p: R = new (G27 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2080(x: number): R { const p: R = new (F27 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2081(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2082(x: number): R { const p: R = new v27(x); p.b = x + 1; p.a = x + 2; return p; }
function f2083(x: number): R { const p: R = new (G27 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2084(x: number): R { const p: R = new (F27 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2085(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2086(x: number): R { const p: R = new v27(x); p.b = x + 1; p.b = x + 2; return p; }
function f2087(x: number): R { const p: R = new (G27 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2088(x: number): R { const p: R = new (F27 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2089(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2090(x: number): R { const p: R = new v27(x); p.b = x + 1; p.c = x + 2; return p; }
function f2091(x: number): R { const p: R = new (G27 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2092(x: number): R { const p: R = new (F27 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2093(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2094(x: number): R { const p: R = new v27(x); p.b = x + 1; p.d = x + 2; return p; }
function f2095(x: number): R { const p: R = new (G27 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2096(x: number): R { const p: R = new (F27 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2097(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2098(x: number): R { const p: R = new v27(x); p.c = x + 1; p.a = x + 2; return p; }
function f2099(x: number): R { const p: R = new (G27 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2100(x: number): R { const p: R = new (F27 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2101(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2102(x: number): R { const p: R = new v27(x); p.c = x + 1; p.b = x + 2; return p; }
function f2103(x: number): R { const p: R = new (G27 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2104(x: number): R { const p: R = new (F27 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2105(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2106(x: number): R { const p: R = new v27(x); p.c = x + 1; p.c = x + 2; return p; }
function f2107(x: number): R { const p: R = new (G27 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2108(x: number): R { const p: R = new (F27 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2109(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2110(x: number): R { const p: R = new v27(x); p.c = x + 1; p.d = x + 2; return p; }
function f2111(x: number): R { const p: R = new (G27 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2112(x: number): R { const p: R = new (F27 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2113(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2114(x: number): R { const p: R = new v27(x); p.d = x + 1; p.a = x + 2; return p; }
function f2115(x: number): R { const p: R = new (G27 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2116(x: number): R { const p: R = new (F27 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2117(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2118(x: number): R { const p: R = new v27(x); p.d = x + 1; p.b = x + 2; return p; }
function f2119(x: number): R { const p: R = new (G27 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2120(x: number): R { const p: R = new (F27 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2121(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2122(x: number): R { const p: R = new v27(x); p.d = x + 1; p.c = x + 2; return p; }
function f2123(x: number): R { const p: R = new (G27 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2124(x: number): R { const p: R = new (F27 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2125(x: number): R { const p: R = new (F27 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2126(x: number): R { const p: R = new v27(x); p.d = x + 1; p.d = x + 2; return p; }
function f2127(x: number): R { const p: R = new (G27 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2128(x: number): R { const p: R = new (F28 as any)(x); p.a = x + 1; return p; }
function f2129(x: number): R { const p: R = new v28(x); p.a = x + 1; return p; }
function f2130(x: number): R { const p: R = new (G28 as any)(x); p.a = x + 1; return p; }
function f2131(x: number): R { const p: R = new (F28 as any)(x); p.b = x + 1; return p; }
function f2132(x: number): R { const p: R = new v28(x); p.b = x + 1; return p; }
function f2133(x: number): R { const p: R = new (G28 as any)(x); p.b = x + 1; return p; }
function f2134(x: number): R { const p: R = new (F28 as any)(x); p.c = x + 1; return p; }
function f2135(x: number): R { const p: R = new v28(x); p.c = x + 1; return p; }
function f2136(x: number): R { const p: R = new (G28 as any)(x); p.c = x + 1; return p; }
function f2137(x: number): R { const p: R = new (F28 as any)(x); p.d = x + 1; return p; }
function f2138(x: number): R { const p: R = new v28(x); p.d = x + 1; return p; }
function f2139(x: number): R { const p: R = new (G28 as any)(x); p.d = x + 1; return p; }
function f2140(x: number): R { const p: R = new (F28 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2141(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2142(x: number): R { const p: R = new v28(x); p.a = x + 1; p.a = x + 2; return p; }
function f2143(x: number): R { const p: R = new (G28 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2144(x: number): R { const p: R = new (F28 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2145(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2146(x: number): R { const p: R = new v28(x); p.a = x + 1; p.b = x + 2; return p; }
function f2147(x: number): R { const p: R = new (G28 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2148(x: number): R { const p: R = new (F28 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2149(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2150(x: number): R { const p: R = new v28(x); p.a = x + 1; p.c = x + 2; return p; }
function f2151(x: number): R { const p: R = new (G28 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2152(x: number): R { const p: R = new (F28 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2153(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2154(x: number): R { const p: R = new v28(x); p.a = x + 1; p.d = x + 2; return p; }
function f2155(x: number): R { const p: R = new (G28 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2156(x: number): R { const p: R = new (F28 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2157(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2158(x: number): R { const p: R = new v28(x); p.b = x + 1; p.a = x + 2; return p; }
function f2159(x: number): R { const p: R = new (G28 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2160(x: number): R { const p: R = new (F28 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2161(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2162(x: number): R { const p: R = new v28(x); p.b = x + 1; p.b = x + 2; return p; }
function f2163(x: number): R { const p: R = new (G28 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2164(x: number): R { const p: R = new (F28 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2165(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2166(x: number): R { const p: R = new v28(x); p.b = x + 1; p.c = x + 2; return p; }
function f2167(x: number): R { const p: R = new (G28 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2168(x: number): R { const p: R = new (F28 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2169(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2170(x: number): R { const p: R = new v28(x); p.b = x + 1; p.d = x + 2; return p; }
function f2171(x: number): R { const p: R = new (G28 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2172(x: number): R { const p: R = new (F28 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2173(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2174(x: number): R { const p: R = new v28(x); p.c = x + 1; p.a = x + 2; return p; }
function f2175(x: number): R { const p: R = new (G28 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2176(x: number): R { const p: R = new (F28 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2177(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2178(x: number): R { const p: R = new v28(x); p.c = x + 1; p.b = x + 2; return p; }
function f2179(x: number): R { const p: R = new (G28 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2180(x: number): R { const p: R = new (F28 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2181(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2182(x: number): R { const p: R = new v28(x); p.c = x + 1; p.c = x + 2; return p; }
function f2183(x: number): R { const p: R = new (G28 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2184(x: number): R { const p: R = new (F28 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2185(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2186(x: number): R { const p: R = new v28(x); p.c = x + 1; p.d = x + 2; return p; }
function f2187(x: number): R { const p: R = new (G28 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2188(x: number): R { const p: R = new (F28 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2189(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2190(x: number): R { const p: R = new v28(x); p.d = x + 1; p.a = x + 2; return p; }
function f2191(x: number): R { const p: R = new (G28 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2192(x: number): R { const p: R = new (F28 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2193(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2194(x: number): R { const p: R = new v28(x); p.d = x + 1; p.b = x + 2; return p; }
function f2195(x: number): R { const p: R = new (G28 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2196(x: number): R { const p: R = new (F28 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2197(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2198(x: number): R { const p: R = new v28(x); p.d = x + 1; p.c = x + 2; return p; }
function f2199(x: number): R { const p: R = new (G28 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2200(x: number): R { const p: R = new (F28 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2201(x: number): R { const p: R = new (F28 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2202(x: number): R { const p: R = new v28(x); p.d = x + 1; p.d = x + 2; return p; }
function f2203(x: number): R { const p: R = new (G28 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2204(x: number): R { const p: R = new (F29 as any)(x); p.a = x + 1; return p; }
function f2205(x: number): R { const p: R = new v29(x); p.a = x + 1; return p; }
function f2206(x: number): R { const p: R = new (G29 as any)(x); p.a = x + 1; return p; }
function f2207(x: number): R { const p: R = new (F29 as any)(x); p.b = x + 1; return p; }
function f2208(x: number): R { const p: R = new v29(x); p.b = x + 1; return p; }
function f2209(x: number): R { const p: R = new (G29 as any)(x); p.b = x + 1; return p; }
function f2210(x: number): R { const p: R = new (F29 as any)(x); p.c = x + 1; return p; }
function f2211(x: number): R { const p: R = new v29(x); p.c = x + 1; return p; }
function f2212(x: number): R { const p: R = new (G29 as any)(x); p.c = x + 1; return p; }
function f2213(x: number): R { const p: R = new (F29 as any)(x); p.d = x + 1; return p; }
function f2214(x: number): R { const p: R = new v29(x); p.d = x + 1; return p; }
function f2215(x: number): R { const p: R = new (G29 as any)(x); p.d = x + 1; return p; }
function f2216(x: number): R { const p: R = new (F29 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2217(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2218(x: number): R { const p: R = new v29(x); p.a = x + 1; p.a = x + 2; return p; }
function f2219(x: number): R { const p: R = new (G29 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2220(x: number): R { const p: R = new (F29 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2221(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2222(x: number): R { const p: R = new v29(x); p.a = x + 1; p.b = x + 2; return p; }
function f2223(x: number): R { const p: R = new (G29 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2224(x: number): R { const p: R = new (F29 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2225(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2226(x: number): R { const p: R = new v29(x); p.a = x + 1; p.c = x + 2; return p; }
function f2227(x: number): R { const p: R = new (G29 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2228(x: number): R { const p: R = new (F29 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2229(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2230(x: number): R { const p: R = new v29(x); p.a = x + 1; p.d = x + 2; return p; }
function f2231(x: number): R { const p: R = new (G29 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2232(x: number): R { const p: R = new (F29 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2233(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2234(x: number): R { const p: R = new v29(x); p.b = x + 1; p.a = x + 2; return p; }
function f2235(x: number): R { const p: R = new (G29 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2236(x: number): R { const p: R = new (F29 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2237(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2238(x: number): R { const p: R = new v29(x); p.b = x + 1; p.b = x + 2; return p; }
function f2239(x: number): R { const p: R = new (G29 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2240(x: number): R { const p: R = new (F29 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2241(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2242(x: number): R { const p: R = new v29(x); p.b = x + 1; p.c = x + 2; return p; }
function f2243(x: number): R { const p: R = new (G29 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2244(x: number): R { const p: R = new (F29 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2245(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2246(x: number): R { const p: R = new v29(x); p.b = x + 1; p.d = x + 2; return p; }
function f2247(x: number): R { const p: R = new (G29 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2248(x: number): R { const p: R = new (F29 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2249(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2250(x: number): R { const p: R = new v29(x); p.c = x + 1; p.a = x + 2; return p; }
function f2251(x: number): R { const p: R = new (G29 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2252(x: number): R { const p: R = new (F29 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2253(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2254(x: number): R { const p: R = new v29(x); p.c = x + 1; p.b = x + 2; return p; }
function f2255(x: number): R { const p: R = new (G29 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2256(x: number): R { const p: R = new (F29 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2257(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2258(x: number): R { const p: R = new v29(x); p.c = x + 1; p.c = x + 2; return p; }
function f2259(x: number): R { const p: R = new (G29 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2260(x: number): R { const p: R = new (F29 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2261(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2262(x: number): R { const p: R = new v29(x); p.c = x + 1; p.d = x + 2; return p; }
function f2263(x: number): R { const p: R = new (G29 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2264(x: number): R { const p: R = new (F29 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2265(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2266(x: number): R { const p: R = new v29(x); p.d = x + 1; p.a = x + 2; return p; }
function f2267(x: number): R { const p: R = new (G29 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2268(x: number): R { const p: R = new (F29 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2269(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2270(x: number): R { const p: R = new v29(x); p.d = x + 1; p.b = x + 2; return p; }
function f2271(x: number): R { const p: R = new (G29 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2272(x: number): R { const p: R = new (F29 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2273(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2274(x: number): R { const p: R = new v29(x); p.d = x + 1; p.c = x + 2; return p; }
function f2275(x: number): R { const p: R = new (G29 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2276(x: number): R { const p: R = new (F29 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2277(x: number): R { const p: R = new (F29 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2278(x: number): R { const p: R = new v29(x); p.d = x + 1; p.d = x + 2; return p; }
function f2279(x: number): R { const p: R = new (G29 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2280(x: number): R { const p: R = new (F30 as any)(x); p.a = x + 1; return p; }
function f2281(x: number): R { const p: R = new v30(x); p.a = x + 1; return p; }
function f2282(x: number): R { const p: R = new (G30 as any)(x); p.a = x + 1; return p; }
function f2283(x: number): R { const p: R = new (F30 as any)(x); p.b = x + 1; return p; }
function f2284(x: number): R { const p: R = new v30(x); p.b = x + 1; return p; }
function f2285(x: number): R { const p: R = new (G30 as any)(x); p.b = x + 1; return p; }
function f2286(x: number): R { const p: R = new (F30 as any)(x); p.c = x + 1; return p; }
function f2287(x: number): R { const p: R = new v30(x); p.c = x + 1; return p; }
function f2288(x: number): R { const p: R = new (G30 as any)(x); p.c = x + 1; return p; }
function f2289(x: number): R { const p: R = new (F30 as any)(x); p.d = x + 1; return p; }
function f2290(x: number): R { const p: R = new v30(x); p.d = x + 1; return p; }
function f2291(x: number): R { const p: R = new (G30 as any)(x); p.d = x + 1; return p; }
function f2292(x: number): R { const p: R = new (F30 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2293(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2294(x: number): R { const p: R = new v30(x); p.a = x + 1; p.a = x + 2; return p; }
function f2295(x: number): R { const p: R = new (G30 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2296(x: number): R { const p: R = new (F30 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2297(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2298(x: number): R { const p: R = new v30(x); p.a = x + 1; p.b = x + 2; return p; }
function f2299(x: number): R { const p: R = new (G30 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2300(x: number): R { const p: R = new (F30 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2301(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2302(x: number): R { const p: R = new v30(x); p.a = x + 1; p.c = x + 2; return p; }
function f2303(x: number): R { const p: R = new (G30 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2304(x: number): R { const p: R = new (F30 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2305(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2306(x: number): R { const p: R = new v30(x); p.a = x + 1; p.d = x + 2; return p; }
function f2307(x: number): R { const p: R = new (G30 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2308(x: number): R { const p: R = new (F30 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2309(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2310(x: number): R { const p: R = new v30(x); p.b = x + 1; p.a = x + 2; return p; }
function f2311(x: number): R { const p: R = new (G30 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2312(x: number): R { const p: R = new (F30 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2313(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2314(x: number): R { const p: R = new v30(x); p.b = x + 1; p.b = x + 2; return p; }
function f2315(x: number): R { const p: R = new (G30 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2316(x: number): R { const p: R = new (F30 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2317(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2318(x: number): R { const p: R = new v30(x); p.b = x + 1; p.c = x + 2; return p; }
function f2319(x: number): R { const p: R = new (G30 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2320(x: number): R { const p: R = new (F30 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2321(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2322(x: number): R { const p: R = new v30(x); p.b = x + 1; p.d = x + 2; return p; }
function f2323(x: number): R { const p: R = new (G30 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2324(x: number): R { const p: R = new (F30 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2325(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2326(x: number): R { const p: R = new v30(x); p.c = x + 1; p.a = x + 2; return p; }
function f2327(x: number): R { const p: R = new (G30 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2328(x: number): R { const p: R = new (F30 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2329(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2330(x: number): R { const p: R = new v30(x); p.c = x + 1; p.b = x + 2; return p; }
function f2331(x: number): R { const p: R = new (G30 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2332(x: number): R { const p: R = new (F30 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2333(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2334(x: number): R { const p: R = new v30(x); p.c = x + 1; p.c = x + 2; return p; }
function f2335(x: number): R { const p: R = new (G30 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2336(x: number): R { const p: R = new (F30 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2337(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2338(x: number): R { const p: R = new v30(x); p.c = x + 1; p.d = x + 2; return p; }
function f2339(x: number): R { const p: R = new (G30 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2340(x: number): R { const p: R = new (F30 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2341(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2342(x: number): R { const p: R = new v30(x); p.d = x + 1; p.a = x + 2; return p; }
function f2343(x: number): R { const p: R = new (G30 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2344(x: number): R { const p: R = new (F30 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2345(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2346(x: number): R { const p: R = new v30(x); p.d = x + 1; p.b = x + 2; return p; }
function f2347(x: number): R { const p: R = new (G30 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2348(x: number): R { const p: R = new (F30 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2349(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2350(x: number): R { const p: R = new v30(x); p.d = x + 1; p.c = x + 2; return p; }
function f2351(x: number): R { const p: R = new (G30 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2352(x: number): R { const p: R = new (F30 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2353(x: number): R { const p: R = new (F30 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2354(x: number): R { const p: R = new v30(x); p.d = x + 1; p.d = x + 2; return p; }
function f2355(x: number): R { const p: R = new (G30 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2356(x: number): R { const p: R = new (F31 as any)(x); p.a = x + 1; return p; }
function f2357(x: number): R { const p: R = new v31(x); p.a = x + 1; return p; }
function f2358(x: number): R { const p: R = new (G31 as any)(x); p.a = x + 1; return p; }
function f2359(x: number): R { const p: R = new (F31 as any)(x); p.b = x + 1; return p; }
function f2360(x: number): R { const p: R = new v31(x); p.b = x + 1; return p; }
function f2361(x: number): R { const p: R = new (G31 as any)(x); p.b = x + 1; return p; }
function f2362(x: number): R { const p: R = new (F31 as any)(x); p.c = x + 1; return p; }
function f2363(x: number): R { const p: R = new v31(x); p.c = x + 1; return p; }
function f2364(x: number): R { const p: R = new (G31 as any)(x); p.c = x + 1; return p; }
function f2365(x: number): R { const p: R = new (F31 as any)(x); p.d = x + 1; return p; }
function f2366(x: number): R { const p: R = new v31(x); p.d = x + 1; return p; }
function f2367(x: number): R { const p: R = new (G31 as any)(x); p.d = x + 1; return p; }
function f2368(x: number): R { const p: R = new (F31 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2369(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2370(x: number): R { const p: R = new v31(x); p.a = x + 1; p.a = x + 2; return p; }
function f2371(x: number): R { const p: R = new (G31 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2372(x: number): R { const p: R = new (F31 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2373(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2374(x: number): R { const p: R = new v31(x); p.a = x + 1; p.b = x + 2; return p; }
function f2375(x: number): R { const p: R = new (G31 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2376(x: number): R { const p: R = new (F31 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2377(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2378(x: number): R { const p: R = new v31(x); p.a = x + 1; p.c = x + 2; return p; }
function f2379(x: number): R { const p: R = new (G31 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2380(x: number): R { const p: R = new (F31 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2381(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2382(x: number): R { const p: R = new v31(x); p.a = x + 1; p.d = x + 2; return p; }
function f2383(x: number): R { const p: R = new (G31 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2384(x: number): R { const p: R = new (F31 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2385(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2386(x: number): R { const p: R = new v31(x); p.b = x + 1; p.a = x + 2; return p; }
function f2387(x: number): R { const p: R = new (G31 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2388(x: number): R { const p: R = new (F31 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2389(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2390(x: number): R { const p: R = new v31(x); p.b = x + 1; p.b = x + 2; return p; }
function f2391(x: number): R { const p: R = new (G31 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2392(x: number): R { const p: R = new (F31 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2393(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2394(x: number): R { const p: R = new v31(x); p.b = x + 1; p.c = x + 2; return p; }
function f2395(x: number): R { const p: R = new (G31 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2396(x: number): R { const p: R = new (F31 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2397(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2398(x: number): R { const p: R = new v31(x); p.b = x + 1; p.d = x + 2; return p; }
function f2399(x: number): R { const p: R = new (G31 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2400(x: number): R { const p: R = new (F31 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2401(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2402(x: number): R { const p: R = new v31(x); p.c = x + 1; p.a = x + 2; return p; }
function f2403(x: number): R { const p: R = new (G31 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2404(x: number): R { const p: R = new (F31 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2405(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2406(x: number): R { const p: R = new v31(x); p.c = x + 1; p.b = x + 2; return p; }
function f2407(x: number): R { const p: R = new (G31 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2408(x: number): R { const p: R = new (F31 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2409(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2410(x: number): R { const p: R = new v31(x); p.c = x + 1; p.c = x + 2; return p; }
function f2411(x: number): R { const p: R = new (G31 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2412(x: number): R { const p: R = new (F31 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2413(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2414(x: number): R { const p: R = new v31(x); p.c = x + 1; p.d = x + 2; return p; }
function f2415(x: number): R { const p: R = new (G31 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2416(x: number): R { const p: R = new (F31 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2417(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2418(x: number): R { const p: R = new v31(x); p.d = x + 1; p.a = x + 2; return p; }
function f2419(x: number): R { const p: R = new (G31 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2420(x: number): R { const p: R = new (F31 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2421(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2422(x: number): R { const p: R = new v31(x); p.d = x + 1; p.b = x + 2; return p; }
function f2423(x: number): R { const p: R = new (G31 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2424(x: number): R { const p: R = new (F31 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2425(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2426(x: number): R { const p: R = new v31(x); p.d = x + 1; p.c = x + 2; return p; }
function f2427(x: number): R { const p: R = new (G31 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2428(x: number): R { const p: R = new (F31 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2429(x: number): R { const p: R = new (F31 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2430(x: number): R { const p: R = new v31(x); p.d = x + 1; p.d = x + 2; return p; }
function f2431(x: number): R { const p: R = new (G31 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2432(x: number): R { const p: R = new (F32 as any)(x); p.a = x + 1; return p; }
function f2433(x: number): R { const p: R = new v32(x); p.a = x + 1; return p; }
function f2434(x: number): R { const p: R = new (G32 as any)(x); p.a = x + 1; return p; }
function f2435(x: number): R { const p: R = new (F32 as any)(x); p.b = x + 1; return p; }
function f2436(x: number): R { const p: R = new v32(x); p.b = x + 1; return p; }
function f2437(x: number): R { const p: R = new (G32 as any)(x); p.b = x + 1; return p; }
function f2438(x: number): R { const p: R = new (F32 as any)(x); p.c = x + 1; return p; }
function f2439(x: number): R { const p: R = new v32(x); p.c = x + 1; return p; }
function f2440(x: number): R { const p: R = new (G32 as any)(x); p.c = x + 1; return p; }
function f2441(x: number): R { const p: R = new (F32 as any)(x); p.d = x + 1; return p; }
function f2442(x: number): R { const p: R = new v32(x); p.d = x + 1; return p; }
function f2443(x: number): R { const p: R = new (G32 as any)(x); p.d = x + 1; return p; }
function f2444(x: number): R { const p: R = new (F32 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2445(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2446(x: number): R { const p: R = new v32(x); p.a = x + 1; p.a = x + 2; return p; }
function f2447(x: number): R { const p: R = new (G32 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2448(x: number): R { const p: R = new (F32 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2449(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2450(x: number): R { const p: R = new v32(x); p.a = x + 1; p.b = x + 2; return p; }
function f2451(x: number): R { const p: R = new (G32 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2452(x: number): R { const p: R = new (F32 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2453(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2454(x: number): R { const p: R = new v32(x); p.a = x + 1; p.c = x + 2; return p; }
function f2455(x: number): R { const p: R = new (G32 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2456(x: number): R { const p: R = new (F32 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2457(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2458(x: number): R { const p: R = new v32(x); p.a = x + 1; p.d = x + 2; return p; }
function f2459(x: number): R { const p: R = new (G32 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2460(x: number): R { const p: R = new (F32 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2461(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2462(x: number): R { const p: R = new v32(x); p.b = x + 1; p.a = x + 2; return p; }
function f2463(x: number): R { const p: R = new (G32 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2464(x: number): R { const p: R = new (F32 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2465(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2466(x: number): R { const p: R = new v32(x); p.b = x + 1; p.b = x + 2; return p; }
function f2467(x: number): R { const p: R = new (G32 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2468(x: number): R { const p: R = new (F32 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2469(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2470(x: number): R { const p: R = new v32(x); p.b = x + 1; p.c = x + 2; return p; }
function f2471(x: number): R { const p: R = new (G32 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2472(x: number): R { const p: R = new (F32 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2473(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2474(x: number): R { const p: R = new v32(x); p.b = x + 1; p.d = x + 2; return p; }
function f2475(x: number): R { const p: R = new (G32 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2476(x: number): R { const p: R = new (F32 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2477(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2478(x: number): R { const p: R = new v32(x); p.c = x + 1; p.a = x + 2; return p; }
function f2479(x: number): R { const p: R = new (G32 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2480(x: number): R { const p: R = new (F32 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2481(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2482(x: number): R { const p: R = new v32(x); p.c = x + 1; p.b = x + 2; return p; }
function f2483(x: number): R { const p: R = new (G32 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2484(x: number): R { const p: R = new (F32 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2485(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2486(x: number): R { const p: R = new v32(x); p.c = x + 1; p.c = x + 2; return p; }
function f2487(x: number): R { const p: R = new (G32 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2488(x: number): R { const p: R = new (F32 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2489(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2490(x: number): R { const p: R = new v32(x); p.c = x + 1; p.d = x + 2; return p; }
function f2491(x: number): R { const p: R = new (G32 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2492(x: number): R { const p: R = new (F32 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2493(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2494(x: number): R { const p: R = new v32(x); p.d = x + 1; p.a = x + 2; return p; }
function f2495(x: number): R { const p: R = new (G32 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2496(x: number): R { const p: R = new (F32 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2497(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2498(x: number): R { const p: R = new v32(x); p.d = x + 1; p.b = x + 2; return p; }
function f2499(x: number): R { const p: R = new (G32 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2500(x: number): R { const p: R = new (F32 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2501(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2502(x: number): R { const p: R = new v32(x); p.d = x + 1; p.c = x + 2; return p; }
function f2503(x: number): R { const p: R = new (G32 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2504(x: number): R { const p: R = new (F32 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2505(x: number): R { const p: R = new (F32 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2506(x: number): R { const p: R = new v32(x); p.d = x + 1; p.d = x + 2; return p; }
function f2507(x: number): R { const p: R = new (G32 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2508(x: number): R { const p: R = new (F33 as any)(x); p.a = x + 1; return p; }
function f2509(x: number): R { const p: R = new v33(x); p.a = x + 1; return p; }
function f2510(x: number): R { const p: R = new (G33 as any)(x); p.a = x + 1; return p; }
function f2511(x: number): R { const p: R = new (F33 as any)(x); p.b = x + 1; return p; }
function f2512(x: number): R { const p: R = new v33(x); p.b = x + 1; return p; }
function f2513(x: number): R { const p: R = new (G33 as any)(x); p.b = x + 1; return p; }
function f2514(x: number): R { const p: R = new (F33 as any)(x); p.c = x + 1; return p; }
function f2515(x: number): R { const p: R = new v33(x); p.c = x + 1; return p; }
function f2516(x: number): R { const p: R = new (G33 as any)(x); p.c = x + 1; return p; }
function f2517(x: number): R { const p: R = new (F33 as any)(x); p.d = x + 1; return p; }
function f2518(x: number): R { const p: R = new v33(x); p.d = x + 1; return p; }
function f2519(x: number): R { const p: R = new (G33 as any)(x); p.d = x + 1; return p; }
function f2520(x: number): R { const p: R = new (F33 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2521(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2522(x: number): R { const p: R = new v33(x); p.a = x + 1; p.a = x + 2; return p; }
function f2523(x: number): R { const p: R = new (G33 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2524(x: number): R { const p: R = new (F33 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2525(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2526(x: number): R { const p: R = new v33(x); p.a = x + 1; p.b = x + 2; return p; }
function f2527(x: number): R { const p: R = new (G33 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2528(x: number): R { const p: R = new (F33 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2529(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2530(x: number): R { const p: R = new v33(x); p.a = x + 1; p.c = x + 2; return p; }
function f2531(x: number): R { const p: R = new (G33 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2532(x: number): R { const p: R = new (F33 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2533(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2534(x: number): R { const p: R = new v33(x); p.a = x + 1; p.d = x + 2; return p; }
function f2535(x: number): R { const p: R = new (G33 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2536(x: number): R { const p: R = new (F33 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2537(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2538(x: number): R { const p: R = new v33(x); p.b = x + 1; p.a = x + 2; return p; }
function f2539(x: number): R { const p: R = new (G33 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2540(x: number): R { const p: R = new (F33 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2541(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2542(x: number): R { const p: R = new v33(x); p.b = x + 1; p.b = x + 2; return p; }
function f2543(x: number): R { const p: R = new (G33 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2544(x: number): R { const p: R = new (F33 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2545(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2546(x: number): R { const p: R = new v33(x); p.b = x + 1; p.c = x + 2; return p; }
function f2547(x: number): R { const p: R = new (G33 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2548(x: number): R { const p: R = new (F33 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2549(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2550(x: number): R { const p: R = new v33(x); p.b = x + 1; p.d = x + 2; return p; }
function f2551(x: number): R { const p: R = new (G33 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2552(x: number): R { const p: R = new (F33 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2553(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2554(x: number): R { const p: R = new v33(x); p.c = x + 1; p.a = x + 2; return p; }
function f2555(x: number): R { const p: R = new (G33 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2556(x: number): R { const p: R = new (F33 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2557(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2558(x: number): R { const p: R = new v33(x); p.c = x + 1; p.b = x + 2; return p; }
function f2559(x: number): R { const p: R = new (G33 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2560(x: number): R { const p: R = new (F33 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2561(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2562(x: number): R { const p: R = new v33(x); p.c = x + 1; p.c = x + 2; return p; }
function f2563(x: number): R { const p: R = new (G33 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2564(x: number): R { const p: R = new (F33 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2565(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2566(x: number): R { const p: R = new v33(x); p.c = x + 1; p.d = x + 2; return p; }
function f2567(x: number): R { const p: R = new (G33 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2568(x: number): R { const p: R = new (F33 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2569(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2570(x: number): R { const p: R = new v33(x); p.d = x + 1; p.a = x + 2; return p; }
function f2571(x: number): R { const p: R = new (G33 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2572(x: number): R { const p: R = new (F33 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2573(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2574(x: number): R { const p: R = new v33(x); p.d = x + 1; p.b = x + 2; return p; }
function f2575(x: number): R { const p: R = new (G33 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2576(x: number): R { const p: R = new (F33 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2577(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2578(x: number): R { const p: R = new v33(x); p.d = x + 1; p.c = x + 2; return p; }
function f2579(x: number): R { const p: R = new (G33 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2580(x: number): R { const p: R = new (F33 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2581(x: number): R { const p: R = new (F33 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2582(x: number): R { const p: R = new v33(x); p.d = x + 1; p.d = x + 2; return p; }
function f2583(x: number): R { const p: R = new (G33 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2584(x: number): R { const p: R = new (F34 as any)(x); p.a = x + 1; return p; }
function f2585(x: number): R { const p: R = new v34(x); p.a = x + 1; return p; }
function f2586(x: number): R { const p: R = new (G34 as any)(x); p.a = x + 1; return p; }
function f2587(x: number): R { const p: R = new (F34 as any)(x); p.b = x + 1; return p; }
function f2588(x: number): R { const p: R = new v34(x); p.b = x + 1; return p; }
function f2589(x: number): R { const p: R = new (G34 as any)(x); p.b = x + 1; return p; }
function f2590(x: number): R { const p: R = new (F34 as any)(x); p.c = x + 1; return p; }
function f2591(x: number): R { const p: R = new v34(x); p.c = x + 1; return p; }
function f2592(x: number): R { const p: R = new (G34 as any)(x); p.c = x + 1; return p; }
function f2593(x: number): R { const p: R = new (F34 as any)(x); p.d = x + 1; return p; }
function f2594(x: number): R { const p: R = new v34(x); p.d = x + 1; return p; }
function f2595(x: number): R { const p: R = new (G34 as any)(x); p.d = x + 1; return p; }
function f2596(x: number): R { const p: R = new (F34 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2597(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2598(x: number): R { const p: R = new v34(x); p.a = x + 1; p.a = x + 2; return p; }
function f2599(x: number): R { const p: R = new (G34 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2600(x: number): R { const p: R = new (F34 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2601(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2602(x: number): R { const p: R = new v34(x); p.a = x + 1; p.b = x + 2; return p; }
function f2603(x: number): R { const p: R = new (G34 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2604(x: number): R { const p: R = new (F34 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2605(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2606(x: number): R { const p: R = new v34(x); p.a = x + 1; p.c = x + 2; return p; }
function f2607(x: number): R { const p: R = new (G34 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2608(x: number): R { const p: R = new (F34 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2609(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2610(x: number): R { const p: R = new v34(x); p.a = x + 1; p.d = x + 2; return p; }
function f2611(x: number): R { const p: R = new (G34 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2612(x: number): R { const p: R = new (F34 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2613(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2614(x: number): R { const p: R = new v34(x); p.b = x + 1; p.a = x + 2; return p; }
function f2615(x: number): R { const p: R = new (G34 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2616(x: number): R { const p: R = new (F34 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2617(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2618(x: number): R { const p: R = new v34(x); p.b = x + 1; p.b = x + 2; return p; }
function f2619(x: number): R { const p: R = new (G34 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2620(x: number): R { const p: R = new (F34 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2621(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2622(x: number): R { const p: R = new v34(x); p.b = x + 1; p.c = x + 2; return p; }
function f2623(x: number): R { const p: R = new (G34 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2624(x: number): R { const p: R = new (F34 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2625(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2626(x: number): R { const p: R = new v34(x); p.b = x + 1; p.d = x + 2; return p; }
function f2627(x: number): R { const p: R = new (G34 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2628(x: number): R { const p: R = new (F34 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2629(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2630(x: number): R { const p: R = new v34(x); p.c = x + 1; p.a = x + 2; return p; }
function f2631(x: number): R { const p: R = new (G34 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2632(x: number): R { const p: R = new (F34 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2633(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2634(x: number): R { const p: R = new v34(x); p.c = x + 1; p.b = x + 2; return p; }
function f2635(x: number): R { const p: R = new (G34 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2636(x: number): R { const p: R = new (F34 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2637(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2638(x: number): R { const p: R = new v34(x); p.c = x + 1; p.c = x + 2; return p; }
function f2639(x: number): R { const p: R = new (G34 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2640(x: number): R { const p: R = new (F34 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2641(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2642(x: number): R { const p: R = new v34(x); p.c = x + 1; p.d = x + 2; return p; }
function f2643(x: number): R { const p: R = new (G34 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2644(x: number): R { const p: R = new (F34 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2645(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2646(x: number): R { const p: R = new v34(x); p.d = x + 1; p.a = x + 2; return p; }
function f2647(x: number): R { const p: R = new (G34 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2648(x: number): R { const p: R = new (F34 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2649(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2650(x: number): R { const p: R = new v34(x); p.d = x + 1; p.b = x + 2; return p; }
function f2651(x: number): R { const p: R = new (G34 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2652(x: number): R { const p: R = new (F34 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2653(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2654(x: number): R { const p: R = new v34(x); p.d = x + 1; p.c = x + 2; return p; }
function f2655(x: number): R { const p: R = new (G34 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2656(x: number): R { const p: R = new (F34 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2657(x: number): R { const p: R = new (F34 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2658(x: number): R { const p: R = new v34(x); p.d = x + 1; p.d = x + 2; return p; }
function f2659(x: number): R { const p: R = new (G34 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2660(x: number): R { const p: R = new (F35 as any)(x); p.a = x + 1; return p; }
function f2661(x: number): R { const p: R = new v35(x); p.a = x + 1; return p; }
function f2662(x: number): R { const p: R = new (G35 as any)(x); p.a = x + 1; return p; }
function f2663(x: number): R { const p: R = new (F35 as any)(x); p.b = x + 1; return p; }
function f2664(x: number): R { const p: R = new v35(x); p.b = x + 1; return p; }
function f2665(x: number): R { const p: R = new (G35 as any)(x); p.b = x + 1; return p; }
function f2666(x: number): R { const p: R = new (F35 as any)(x); p.c = x + 1; return p; }
function f2667(x: number): R { const p: R = new v35(x); p.c = x + 1; return p; }
function f2668(x: number): R { const p: R = new (G35 as any)(x); p.c = x + 1; return p; }
function f2669(x: number): R { const p: R = new (F35 as any)(x); p.d = x + 1; return p; }
function f2670(x: number): R { const p: R = new v35(x); p.d = x + 1; return p; }
function f2671(x: number): R { const p: R = new (G35 as any)(x); p.d = x + 1; return p; }
function f2672(x: number): R { const p: R = new (F35 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2673(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2674(x: number): R { const p: R = new v35(x); p.a = x + 1; p.a = x + 2; return p; }
function f2675(x: number): R { const p: R = new (G35 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2676(x: number): R { const p: R = new (F35 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2677(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2678(x: number): R { const p: R = new v35(x); p.a = x + 1; p.b = x + 2; return p; }
function f2679(x: number): R { const p: R = new (G35 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2680(x: number): R { const p: R = new (F35 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2681(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2682(x: number): R { const p: R = new v35(x); p.a = x + 1; p.c = x + 2; return p; }
function f2683(x: number): R { const p: R = new (G35 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2684(x: number): R { const p: R = new (F35 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2685(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2686(x: number): R { const p: R = new v35(x); p.a = x + 1; p.d = x + 2; return p; }
function f2687(x: number): R { const p: R = new (G35 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2688(x: number): R { const p: R = new (F35 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2689(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2690(x: number): R { const p: R = new v35(x); p.b = x + 1; p.a = x + 2; return p; }
function f2691(x: number): R { const p: R = new (G35 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2692(x: number): R { const p: R = new (F35 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2693(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2694(x: number): R { const p: R = new v35(x); p.b = x + 1; p.b = x + 2; return p; }
function f2695(x: number): R { const p: R = new (G35 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2696(x: number): R { const p: R = new (F35 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2697(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2698(x: number): R { const p: R = new v35(x); p.b = x + 1; p.c = x + 2; return p; }
function f2699(x: number): R { const p: R = new (G35 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2700(x: number): R { const p: R = new (F35 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2701(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2702(x: number): R { const p: R = new v35(x); p.b = x + 1; p.d = x + 2; return p; }
function f2703(x: number): R { const p: R = new (G35 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2704(x: number): R { const p: R = new (F35 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2705(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2706(x: number): R { const p: R = new v35(x); p.c = x + 1; p.a = x + 2; return p; }
function f2707(x: number): R { const p: R = new (G35 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2708(x: number): R { const p: R = new (F35 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2709(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2710(x: number): R { const p: R = new v35(x); p.c = x + 1; p.b = x + 2; return p; }
function f2711(x: number): R { const p: R = new (G35 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2712(x: number): R { const p: R = new (F35 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2713(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2714(x: number): R { const p: R = new v35(x); p.c = x + 1; p.c = x + 2; return p; }
function f2715(x: number): R { const p: R = new (G35 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2716(x: number): R { const p: R = new (F35 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2717(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2718(x: number): R { const p: R = new v35(x); p.c = x + 1; p.d = x + 2; return p; }
function f2719(x: number): R { const p: R = new (G35 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2720(x: number): R { const p: R = new (F35 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2721(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2722(x: number): R { const p: R = new v35(x); p.d = x + 1; p.a = x + 2; return p; }
function f2723(x: number): R { const p: R = new (G35 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2724(x: number): R { const p: R = new (F35 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2725(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2726(x: number): R { const p: R = new v35(x); p.d = x + 1; p.b = x + 2; return p; }
function f2727(x: number): R { const p: R = new (G35 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2728(x: number): R { const p: R = new (F35 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2729(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2730(x: number): R { const p: R = new v35(x); p.d = x + 1; p.c = x + 2; return p; }
function f2731(x: number): R { const p: R = new (G35 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2732(x: number): R { const p: R = new (F35 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2733(x: number): R { const p: R = new (F35 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2734(x: number): R { const p: R = new v35(x); p.d = x + 1; p.d = x + 2; return p; }
function f2735(x: number): R { const p: R = new (G35 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2736(x: number): R { const p: R = new (F36 as any)(x); p.a = x + 1; return p; }
function f2737(x: number): R { const p: R = new v36(x); p.a = x + 1; return p; }
function f2738(x: number): R { const p: R = new (G36 as any)(x); p.a = x + 1; return p; }
function f2739(x: number): R { const p: R = new (F36 as any)(x); p.b = x + 1; return p; }
function f2740(x: number): R { const p: R = new v36(x); p.b = x + 1; return p; }
function f2741(x: number): R { const p: R = new (G36 as any)(x); p.b = x + 1; return p; }
function f2742(x: number): R { const p: R = new (F36 as any)(x); p.c = x + 1; return p; }
function f2743(x: number): R { const p: R = new v36(x); p.c = x + 1; return p; }
function f2744(x: number): R { const p: R = new (G36 as any)(x); p.c = x + 1; return p; }
function f2745(x: number): R { const p: R = new (F36 as any)(x); p.d = x + 1; return p; }
function f2746(x: number): R { const p: R = new v36(x); p.d = x + 1; return p; }
function f2747(x: number): R { const p: R = new (G36 as any)(x); p.d = x + 1; return p; }
function f2748(x: number): R { const p: R = new (F36 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2749(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2750(x: number): R { const p: R = new v36(x); p.a = x + 1; p.a = x + 2; return p; }
function f2751(x: number): R { const p: R = new (G36 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2752(x: number): R { const p: R = new (F36 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2753(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2754(x: number): R { const p: R = new v36(x); p.a = x + 1; p.b = x + 2; return p; }
function f2755(x: number): R { const p: R = new (G36 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2756(x: number): R { const p: R = new (F36 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2757(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2758(x: number): R { const p: R = new v36(x); p.a = x + 1; p.c = x + 2; return p; }
function f2759(x: number): R { const p: R = new (G36 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2760(x: number): R { const p: R = new (F36 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2761(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2762(x: number): R { const p: R = new v36(x); p.a = x + 1; p.d = x + 2; return p; }
function f2763(x: number): R { const p: R = new (G36 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2764(x: number): R { const p: R = new (F36 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2765(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2766(x: number): R { const p: R = new v36(x); p.b = x + 1; p.a = x + 2; return p; }
function f2767(x: number): R { const p: R = new (G36 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2768(x: number): R { const p: R = new (F36 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2769(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2770(x: number): R { const p: R = new v36(x); p.b = x + 1; p.b = x + 2; return p; }
function f2771(x: number): R { const p: R = new (G36 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2772(x: number): R { const p: R = new (F36 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2773(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2774(x: number): R { const p: R = new v36(x); p.b = x + 1; p.c = x + 2; return p; }
function f2775(x: number): R { const p: R = new (G36 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2776(x: number): R { const p: R = new (F36 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2777(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2778(x: number): R { const p: R = new v36(x); p.b = x + 1; p.d = x + 2; return p; }
function f2779(x: number): R { const p: R = new (G36 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2780(x: number): R { const p: R = new (F36 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2781(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2782(x: number): R { const p: R = new v36(x); p.c = x + 1; p.a = x + 2; return p; }
function f2783(x: number): R { const p: R = new (G36 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2784(x: number): R { const p: R = new (F36 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2785(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2786(x: number): R { const p: R = new v36(x); p.c = x + 1; p.b = x + 2; return p; }
function f2787(x: number): R { const p: R = new (G36 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2788(x: number): R { const p: R = new (F36 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2789(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2790(x: number): R { const p: R = new v36(x); p.c = x + 1; p.c = x + 2; return p; }
function f2791(x: number): R { const p: R = new (G36 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2792(x: number): R { const p: R = new (F36 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2793(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2794(x: number): R { const p: R = new v36(x); p.c = x + 1; p.d = x + 2; return p; }
function f2795(x: number): R { const p: R = new (G36 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2796(x: number): R { const p: R = new (F36 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2797(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2798(x: number): R { const p: R = new v36(x); p.d = x + 1; p.a = x + 2; return p; }
function f2799(x: number): R { const p: R = new (G36 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2800(x: number): R { const p: R = new (F36 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2801(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2802(x: number): R { const p: R = new v36(x); p.d = x + 1; p.b = x + 2; return p; }
function f2803(x: number): R { const p: R = new (G36 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2804(x: number): R { const p: R = new (F36 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2805(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2806(x: number): R { const p: R = new v36(x); p.d = x + 1; p.c = x + 2; return p; }
function f2807(x: number): R { const p: R = new (G36 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2808(x: number): R { const p: R = new (F36 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2809(x: number): R { const p: R = new (F36 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2810(x: number): R { const p: R = new v36(x); p.d = x + 1; p.d = x + 2; return p; }
function f2811(x: number): R { const p: R = new (G36 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2812(x: number): R { const p: R = new (F37 as any)(x); p.a = x + 1; return p; }
function f2813(x: number): R { const p: R = new v37(x); p.a = x + 1; return p; }
function f2814(x: number): R { const p: R = new (G37 as any)(x); p.a = x + 1; return p; }
function f2815(x: number): R { const p: R = new (F37 as any)(x); p.b = x + 1; return p; }
function f2816(x: number): R { const p: R = new v37(x); p.b = x + 1; return p; }
function f2817(x: number): R { const p: R = new (G37 as any)(x); p.b = x + 1; return p; }
function f2818(x: number): R { const p: R = new (F37 as any)(x); p.c = x + 1; return p; }
function f2819(x: number): R { const p: R = new v37(x); p.c = x + 1; return p; }
function f2820(x: number): R { const p: R = new (G37 as any)(x); p.c = x + 1; return p; }
function f2821(x: number): R { const p: R = new (F37 as any)(x); p.d = x + 1; return p; }
function f2822(x: number): R { const p: R = new v37(x); p.d = x + 1; return p; }
function f2823(x: number): R { const p: R = new (G37 as any)(x); p.d = x + 1; return p; }
function f2824(x: number): R { const p: R = new (F37 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2825(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2826(x: number): R { const p: R = new v37(x); p.a = x + 1; p.a = x + 2; return p; }
function f2827(x: number): R { const p: R = new (G37 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2828(x: number): R { const p: R = new (F37 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2829(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2830(x: number): R { const p: R = new v37(x); p.a = x + 1; p.b = x + 2; return p; }
function f2831(x: number): R { const p: R = new (G37 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2832(x: number): R { const p: R = new (F37 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2833(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2834(x: number): R { const p: R = new v37(x); p.a = x + 1; p.c = x + 2; return p; }
function f2835(x: number): R { const p: R = new (G37 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2836(x: number): R { const p: R = new (F37 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2837(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2838(x: number): R { const p: R = new v37(x); p.a = x + 1; p.d = x + 2; return p; }
function f2839(x: number): R { const p: R = new (G37 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2840(x: number): R { const p: R = new (F37 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2841(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2842(x: number): R { const p: R = new v37(x); p.b = x + 1; p.a = x + 2; return p; }
function f2843(x: number): R { const p: R = new (G37 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2844(x: number): R { const p: R = new (F37 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2845(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2846(x: number): R { const p: R = new v37(x); p.b = x + 1; p.b = x + 2; return p; }
function f2847(x: number): R { const p: R = new (G37 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2848(x: number): R { const p: R = new (F37 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2849(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2850(x: number): R { const p: R = new v37(x); p.b = x + 1; p.c = x + 2; return p; }
function f2851(x: number): R { const p: R = new (G37 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2852(x: number): R { const p: R = new (F37 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2853(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2854(x: number): R { const p: R = new v37(x); p.b = x + 1; p.d = x + 2; return p; }
function f2855(x: number): R { const p: R = new (G37 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2856(x: number): R { const p: R = new (F37 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2857(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2858(x: number): R { const p: R = new v37(x); p.c = x + 1; p.a = x + 2; return p; }
function f2859(x: number): R { const p: R = new (G37 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2860(x: number): R { const p: R = new (F37 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2861(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2862(x: number): R { const p: R = new v37(x); p.c = x + 1; p.b = x + 2; return p; }
function f2863(x: number): R { const p: R = new (G37 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2864(x: number): R { const p: R = new (F37 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2865(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2866(x: number): R { const p: R = new v37(x); p.c = x + 1; p.c = x + 2; return p; }
function f2867(x: number): R { const p: R = new (G37 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2868(x: number): R { const p: R = new (F37 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2869(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2870(x: number): R { const p: R = new v37(x); p.c = x + 1; p.d = x + 2; return p; }
function f2871(x: number): R { const p: R = new (G37 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2872(x: number): R { const p: R = new (F37 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2873(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2874(x: number): R { const p: R = new v37(x); p.d = x + 1; p.a = x + 2; return p; }
function f2875(x: number): R { const p: R = new (G37 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2876(x: number): R { const p: R = new (F37 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2877(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2878(x: number): R { const p: R = new v37(x); p.d = x + 1; p.b = x + 2; return p; }
function f2879(x: number): R { const p: R = new (G37 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2880(x: number): R { const p: R = new (F37 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2881(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2882(x: number): R { const p: R = new v37(x); p.d = x + 1; p.c = x + 2; return p; }
function f2883(x: number): R { const p: R = new (G37 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2884(x: number): R { const p: R = new (F37 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2885(x: number): R { const p: R = new (F37 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2886(x: number): R { const p: R = new v37(x); p.d = x + 1; p.d = x + 2; return p; }
function f2887(x: number): R { const p: R = new (G37 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2888(x: number): R { const p: R = new (F38 as any)(x); p.a = x + 1; return p; }
function f2889(x: number): R { const p: R = new v38(x); p.a = x + 1; return p; }
function f2890(x: number): R { const p: R = new (G38 as any)(x); p.a = x + 1; return p; }
function f2891(x: number): R { const p: R = new (F38 as any)(x); p.b = x + 1; return p; }
function f2892(x: number): R { const p: R = new v38(x); p.b = x + 1; return p; }
function f2893(x: number): R { const p: R = new (G38 as any)(x); p.b = x + 1; return p; }
function f2894(x: number): R { const p: R = new (F38 as any)(x); p.c = x + 1; return p; }
function f2895(x: number): R { const p: R = new v38(x); p.c = x + 1; return p; }
function f2896(x: number): R { const p: R = new (G38 as any)(x); p.c = x + 1; return p; }
function f2897(x: number): R { const p: R = new (F38 as any)(x); p.d = x + 1; return p; }
function f2898(x: number): R { const p: R = new v38(x); p.d = x + 1; return p; }
function f2899(x: number): R { const p: R = new (G38 as any)(x); p.d = x + 1; return p; }
function f2900(x: number): R { const p: R = new (F38 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2901(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2902(x: number): R { const p: R = new v38(x); p.a = x + 1; p.a = x + 2; return p; }
function f2903(x: number): R { const p: R = new (G38 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2904(x: number): R { const p: R = new (F38 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2905(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2906(x: number): R { const p: R = new v38(x); p.a = x + 1; p.b = x + 2; return p; }
function f2907(x: number): R { const p: R = new (G38 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2908(x: number): R { const p: R = new (F38 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2909(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2910(x: number): R { const p: R = new v38(x); p.a = x + 1; p.c = x + 2; return p; }
function f2911(x: number): R { const p: R = new (G38 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2912(x: number): R { const p: R = new (F38 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2913(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2914(x: number): R { const p: R = new v38(x); p.a = x + 1; p.d = x + 2; return p; }
function f2915(x: number): R { const p: R = new (G38 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2916(x: number): R { const p: R = new (F38 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2917(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2918(x: number): R { const p: R = new v38(x); p.b = x + 1; p.a = x + 2; return p; }
function f2919(x: number): R { const p: R = new (G38 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2920(x: number): R { const p: R = new (F38 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2921(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2922(x: number): R { const p: R = new v38(x); p.b = x + 1; p.b = x + 2; return p; }
function f2923(x: number): R { const p: R = new (G38 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2924(x: number): R { const p: R = new (F38 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2925(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f2926(x: number): R { const p: R = new v38(x); p.b = x + 1; p.c = x + 2; return p; }
function f2927(x: number): R { const p: R = new (G38 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f2928(x: number): R { const p: R = new (F38 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2929(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f2930(x: number): R { const p: R = new v38(x); p.b = x + 1; p.d = x + 2; return p; }
function f2931(x: number): R { const p: R = new (G38 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f2932(x: number): R { const p: R = new (F38 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2933(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f2934(x: number): R { const p: R = new v38(x); p.c = x + 1; p.a = x + 2; return p; }
function f2935(x: number): R { const p: R = new (G38 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f2936(x: number): R { const p: R = new (F38 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2937(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f2938(x: number): R { const p: R = new v38(x); p.c = x + 1; p.b = x + 2; return p; }
function f2939(x: number): R { const p: R = new (G38 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f2940(x: number): R { const p: R = new (F38 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2941(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f2942(x: number): R { const p: R = new v38(x); p.c = x + 1; p.c = x + 2; return p; }
function f2943(x: number): R { const p: R = new (G38 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f2944(x: number): R { const p: R = new (F38 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2945(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f2946(x: number): R { const p: R = new v38(x); p.c = x + 1; p.d = x + 2; return p; }
function f2947(x: number): R { const p: R = new (G38 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f2948(x: number): R { const p: R = new (F38 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2949(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f2950(x: number): R { const p: R = new v38(x); p.d = x + 1; p.a = x + 2; return p; }
function f2951(x: number): R { const p: R = new (G38 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f2952(x: number): R { const p: R = new (F38 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2953(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f2954(x: number): R { const p: R = new v38(x); p.d = x + 1; p.b = x + 2; return p; }
function f2955(x: number): R { const p: R = new (G38 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f2956(x: number): R { const p: R = new (F38 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2957(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f2958(x: number): R { const p: R = new v38(x); p.d = x + 1; p.c = x + 2; return p; }
function f2959(x: number): R { const p: R = new (G38 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f2960(x: number): R { const p: R = new (F38 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2961(x: number): R { const p: R = new (F38 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f2962(x: number): R { const p: R = new v38(x); p.d = x + 1; p.d = x + 2; return p; }
function f2963(x: number): R { const p: R = new (G38 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f2964(x: number): R { const p: R = new (F39 as any)(x); p.a = x + 1; return p; }
function f2965(x: number): R { const p: R = new v39(x); p.a = x + 1; return p; }
function f2966(x: number): R { const p: R = new (G39 as any)(x); p.a = x + 1; return p; }
function f2967(x: number): R { const p: R = new (F39 as any)(x); p.b = x + 1; return p; }
function f2968(x: number): R { const p: R = new v39(x); p.b = x + 1; return p; }
function f2969(x: number): R { const p: R = new (G39 as any)(x); p.b = x + 1; return p; }
function f2970(x: number): R { const p: R = new (F39 as any)(x); p.c = x + 1; return p; }
function f2971(x: number): R { const p: R = new v39(x); p.c = x + 1; return p; }
function f2972(x: number): R { const p: R = new (G39 as any)(x); p.c = x + 1; return p; }
function f2973(x: number): R { const p: R = new (F39 as any)(x); p.d = x + 1; return p; }
function f2974(x: number): R { const p: R = new v39(x); p.d = x + 1; return p; }
function f2975(x: number): R { const p: R = new (G39 as any)(x); p.d = x + 1; return p; }
function f2976(x: number): R { const p: R = new (F39 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2977(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f2978(x: number): R { const p: R = new v39(x); p.a = x + 1; p.a = x + 2; return p; }
function f2979(x: number): R { const p: R = new (G39 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f2980(x: number): R { const p: R = new (F39 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2981(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f2982(x: number): R { const p: R = new v39(x); p.a = x + 1; p.b = x + 2; return p; }
function f2983(x: number): R { const p: R = new (G39 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f2984(x: number): R { const p: R = new (F39 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2985(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f2986(x: number): R { const p: R = new v39(x); p.a = x + 1; p.c = x + 2; return p; }
function f2987(x: number): R { const p: R = new (G39 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f2988(x: number): R { const p: R = new (F39 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2989(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f2990(x: number): R { const p: R = new v39(x); p.a = x + 1; p.d = x + 2; return p; }
function f2991(x: number): R { const p: R = new (G39 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f2992(x: number): R { const p: R = new (F39 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2993(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f2994(x: number): R { const p: R = new v39(x); p.b = x + 1; p.a = x + 2; return p; }
function f2995(x: number): R { const p: R = new (G39 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f2996(x: number): R { const p: R = new (F39 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f2997(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f2998(x: number): R { const p: R = new v39(x); p.b = x + 1; p.b = x + 2; return p; }
function f2999(x: number): R { const p: R = new (G39 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3000(x: number): R { const p: R = new (F39 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3001(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3002(x: number): R { const p: R = new v39(x); p.b = x + 1; p.c = x + 2; return p; }
function f3003(x: number): R { const p: R = new (G39 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3004(x: number): R { const p: R = new (F39 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3005(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3006(x: number): R { const p: R = new v39(x); p.b = x + 1; p.d = x + 2; return p; }
function f3007(x: number): R { const p: R = new (G39 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3008(x: number): R { const p: R = new (F39 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3009(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3010(x: number): R { const p: R = new v39(x); p.c = x + 1; p.a = x + 2; return p; }
function f3011(x: number): R { const p: R = new (G39 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3012(x: number): R { const p: R = new (F39 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3013(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3014(x: number): R { const p: R = new v39(x); p.c = x + 1; p.b = x + 2; return p; }
function f3015(x: number): R { const p: R = new (G39 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3016(x: number): R { const p: R = new (F39 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3017(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3018(x: number): R { const p: R = new v39(x); p.c = x + 1; p.c = x + 2; return p; }
function f3019(x: number): R { const p: R = new (G39 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3020(x: number): R { const p: R = new (F39 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3021(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3022(x: number): R { const p: R = new v39(x); p.c = x + 1; p.d = x + 2; return p; }
function f3023(x: number): R { const p: R = new (G39 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3024(x: number): R { const p: R = new (F39 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3025(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3026(x: number): R { const p: R = new v39(x); p.d = x + 1; p.a = x + 2; return p; }
function f3027(x: number): R { const p: R = new (G39 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3028(x: number): R { const p: R = new (F39 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3029(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3030(x: number): R { const p: R = new v39(x); p.d = x + 1; p.b = x + 2; return p; }
function f3031(x: number): R { const p: R = new (G39 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3032(x: number): R { const p: R = new (F39 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3033(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3034(x: number): R { const p: R = new v39(x); p.d = x + 1; p.c = x + 2; return p; }
function f3035(x: number): R { const p: R = new (G39 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3036(x: number): R { const p: R = new (F39 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3037(x: number): R { const p: R = new (F39 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3038(x: number): R { const p: R = new v39(x); p.d = x + 1; p.d = x + 2; return p; }
function f3039(x: number): R { const p: R = new (G39 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3040(x: number): R { const p: R = new (F40 as any)(x); p.a = x + 1; return p; }
function f3041(x: number): R { const p: R = new v40(x); p.a = x + 1; return p; }
function f3042(x: number): R { const p: R = new (G40 as any)(x); p.a = x + 1; return p; }
function f3043(x: number): R { const p: R = new (F40 as any)(x); p.b = x + 1; return p; }
function f3044(x: number): R { const p: R = new v40(x); p.b = x + 1; return p; }
function f3045(x: number): R { const p: R = new (G40 as any)(x); p.b = x + 1; return p; }
function f3046(x: number): R { const p: R = new (F40 as any)(x); p.c = x + 1; return p; }
function f3047(x: number): R { const p: R = new v40(x); p.c = x + 1; return p; }
function f3048(x: number): R { const p: R = new (G40 as any)(x); p.c = x + 1; return p; }
function f3049(x: number): R { const p: R = new (F40 as any)(x); p.d = x + 1; return p; }
function f3050(x: number): R { const p: R = new v40(x); p.d = x + 1; return p; }
function f3051(x: number): R { const p: R = new (G40 as any)(x); p.d = x + 1; return p; }
function f3052(x: number): R { const p: R = new (F40 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3053(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3054(x: number): R { const p: R = new v40(x); p.a = x + 1; p.a = x + 2; return p; }
function f3055(x: number): R { const p: R = new (G40 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3056(x: number): R { const p: R = new (F40 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3057(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3058(x: number): R { const p: R = new v40(x); p.a = x + 1; p.b = x + 2; return p; }
function f3059(x: number): R { const p: R = new (G40 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3060(x: number): R { const p: R = new (F40 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3061(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3062(x: number): R { const p: R = new v40(x); p.a = x + 1; p.c = x + 2; return p; }
function f3063(x: number): R { const p: R = new (G40 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3064(x: number): R { const p: R = new (F40 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3065(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3066(x: number): R { const p: R = new v40(x); p.a = x + 1; p.d = x + 2; return p; }
function f3067(x: number): R { const p: R = new (G40 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3068(x: number): R { const p: R = new (F40 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3069(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3070(x: number): R { const p: R = new v40(x); p.b = x + 1; p.a = x + 2; return p; }
function f3071(x: number): R { const p: R = new (G40 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3072(x: number): R { const p: R = new (F40 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3073(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3074(x: number): R { const p: R = new v40(x); p.b = x + 1; p.b = x + 2; return p; }
function f3075(x: number): R { const p: R = new (G40 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3076(x: number): R { const p: R = new (F40 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3077(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3078(x: number): R { const p: R = new v40(x); p.b = x + 1; p.c = x + 2; return p; }
function f3079(x: number): R { const p: R = new (G40 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3080(x: number): R { const p: R = new (F40 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3081(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3082(x: number): R { const p: R = new v40(x); p.b = x + 1; p.d = x + 2; return p; }
function f3083(x: number): R { const p: R = new (G40 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3084(x: number): R { const p: R = new (F40 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3085(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3086(x: number): R { const p: R = new v40(x); p.c = x + 1; p.a = x + 2; return p; }
function f3087(x: number): R { const p: R = new (G40 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3088(x: number): R { const p: R = new (F40 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3089(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3090(x: number): R { const p: R = new v40(x); p.c = x + 1; p.b = x + 2; return p; }
function f3091(x: number): R { const p: R = new (G40 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3092(x: number): R { const p: R = new (F40 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3093(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3094(x: number): R { const p: R = new v40(x); p.c = x + 1; p.c = x + 2; return p; }
function f3095(x: number): R { const p: R = new (G40 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3096(x: number): R { const p: R = new (F40 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3097(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3098(x: number): R { const p: R = new v40(x); p.c = x + 1; p.d = x + 2; return p; }
function f3099(x: number): R { const p: R = new (G40 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3100(x: number): R { const p: R = new (F40 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3101(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3102(x: number): R { const p: R = new v40(x); p.d = x + 1; p.a = x + 2; return p; }
function f3103(x: number): R { const p: R = new (G40 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3104(x: number): R { const p: R = new (F40 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3105(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3106(x: number): R { const p: R = new v40(x); p.d = x + 1; p.b = x + 2; return p; }
function f3107(x: number): R { const p: R = new (G40 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3108(x: number): R { const p: R = new (F40 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3109(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3110(x: number): R { const p: R = new v40(x); p.d = x + 1; p.c = x + 2; return p; }
function f3111(x: number): R { const p: R = new (G40 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3112(x: number): R { const p: R = new (F40 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3113(x: number): R { const p: R = new (F40 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3114(x: number): R { const p: R = new v40(x); p.d = x + 1; p.d = x + 2; return p; }
function f3115(x: number): R { const p: R = new (G40 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3116(x: number): R { const p: R = new (F41 as any)(x); p.a = x + 1; return p; }
function f3117(x: number): R { const p: R = new v41(x); p.a = x + 1; return p; }
function f3118(x: number): R { const p: R = new (G41 as any)(x); p.a = x + 1; return p; }
function f3119(x: number): R { const p: R = new (F41 as any)(x); p.b = x + 1; return p; }
function f3120(x: number): R { const p: R = new v41(x); p.b = x + 1; return p; }
function f3121(x: number): R { const p: R = new (G41 as any)(x); p.b = x + 1; return p; }
function f3122(x: number): R { const p: R = new (F41 as any)(x); p.c = x + 1; return p; }
function f3123(x: number): R { const p: R = new v41(x); p.c = x + 1; return p; }
function f3124(x: number): R { const p: R = new (G41 as any)(x); p.c = x + 1; return p; }
function f3125(x: number): R { const p: R = new (F41 as any)(x); p.d = x + 1; return p; }
function f3126(x: number): R { const p: R = new v41(x); p.d = x + 1; return p; }
function f3127(x: number): R { const p: R = new (G41 as any)(x); p.d = x + 1; return p; }
function f3128(x: number): R { const p: R = new (F41 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3129(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3130(x: number): R { const p: R = new v41(x); p.a = x + 1; p.a = x + 2; return p; }
function f3131(x: number): R { const p: R = new (G41 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3132(x: number): R { const p: R = new (F41 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3133(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3134(x: number): R { const p: R = new v41(x); p.a = x + 1; p.b = x + 2; return p; }
function f3135(x: number): R { const p: R = new (G41 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3136(x: number): R { const p: R = new (F41 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3137(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3138(x: number): R { const p: R = new v41(x); p.a = x + 1; p.c = x + 2; return p; }
function f3139(x: number): R { const p: R = new (G41 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3140(x: number): R { const p: R = new (F41 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3141(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3142(x: number): R { const p: R = new v41(x); p.a = x + 1; p.d = x + 2; return p; }
function f3143(x: number): R { const p: R = new (G41 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3144(x: number): R { const p: R = new (F41 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3145(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3146(x: number): R { const p: R = new v41(x); p.b = x + 1; p.a = x + 2; return p; }
function f3147(x: number): R { const p: R = new (G41 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3148(x: number): R { const p: R = new (F41 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3149(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3150(x: number): R { const p: R = new v41(x); p.b = x + 1; p.b = x + 2; return p; }
function f3151(x: number): R { const p: R = new (G41 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3152(x: number): R { const p: R = new (F41 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3153(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3154(x: number): R { const p: R = new v41(x); p.b = x + 1; p.c = x + 2; return p; }
function f3155(x: number): R { const p: R = new (G41 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3156(x: number): R { const p: R = new (F41 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3157(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3158(x: number): R { const p: R = new v41(x); p.b = x + 1; p.d = x + 2; return p; }
function f3159(x: number): R { const p: R = new (G41 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3160(x: number): R { const p: R = new (F41 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3161(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3162(x: number): R { const p: R = new v41(x); p.c = x + 1; p.a = x + 2; return p; }
function f3163(x: number): R { const p: R = new (G41 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3164(x: number): R { const p: R = new (F41 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3165(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3166(x: number): R { const p: R = new v41(x); p.c = x + 1; p.b = x + 2; return p; }
function f3167(x: number): R { const p: R = new (G41 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3168(x: number): R { const p: R = new (F41 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3169(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3170(x: number): R { const p: R = new v41(x); p.c = x + 1; p.c = x + 2; return p; }
function f3171(x: number): R { const p: R = new (G41 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3172(x: number): R { const p: R = new (F41 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3173(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3174(x: number): R { const p: R = new v41(x); p.c = x + 1; p.d = x + 2; return p; }
function f3175(x: number): R { const p: R = new (G41 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3176(x: number): R { const p: R = new (F41 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3177(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3178(x: number): R { const p: R = new v41(x); p.d = x + 1; p.a = x + 2; return p; }
function f3179(x: number): R { const p: R = new (G41 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3180(x: number): R { const p: R = new (F41 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3181(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3182(x: number): R { const p: R = new v41(x); p.d = x + 1; p.b = x + 2; return p; }
function f3183(x: number): R { const p: R = new (G41 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3184(x: number): R { const p: R = new (F41 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3185(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3186(x: number): R { const p: R = new v41(x); p.d = x + 1; p.c = x + 2; return p; }
function f3187(x: number): R { const p: R = new (G41 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3188(x: number): R { const p: R = new (F41 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3189(x: number): R { const p: R = new (F41 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3190(x: number): R { const p: R = new v41(x); p.d = x + 1; p.d = x + 2; return p; }
function f3191(x: number): R { const p: R = new (G41 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3192(x: number): R { const p: R = new (F42 as any)(x); p.a = x + 1; return p; }
function f3193(x: number): R { const p: R = new v42(x); p.a = x + 1; return p; }
function f3194(x: number): R { const p: R = new (G42 as any)(x); p.a = x + 1; return p; }
function f3195(x: number): R { const p: R = new (F42 as any)(x); p.b = x + 1; return p; }
function f3196(x: number): R { const p: R = new v42(x); p.b = x + 1; return p; }
function f3197(x: number): R { const p: R = new (G42 as any)(x); p.b = x + 1; return p; }
function f3198(x: number): R { const p: R = new (F42 as any)(x); p.c = x + 1; return p; }
function f3199(x: number): R { const p: R = new v42(x); p.c = x + 1; return p; }
function f3200(x: number): R { const p: R = new (G42 as any)(x); p.c = x + 1; return p; }
function f3201(x: number): R { const p: R = new (F42 as any)(x); p.d = x + 1; return p; }
function f3202(x: number): R { const p: R = new v42(x); p.d = x + 1; return p; }
function f3203(x: number): R { const p: R = new (G42 as any)(x); p.d = x + 1; return p; }
function f3204(x: number): R { const p: R = new (F42 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3205(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3206(x: number): R { const p: R = new v42(x); p.a = x + 1; p.a = x + 2; return p; }
function f3207(x: number): R { const p: R = new (G42 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3208(x: number): R { const p: R = new (F42 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3209(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3210(x: number): R { const p: R = new v42(x); p.a = x + 1; p.b = x + 2; return p; }
function f3211(x: number): R { const p: R = new (G42 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3212(x: number): R { const p: R = new (F42 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3213(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3214(x: number): R { const p: R = new v42(x); p.a = x + 1; p.c = x + 2; return p; }
function f3215(x: number): R { const p: R = new (G42 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3216(x: number): R { const p: R = new (F42 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3217(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3218(x: number): R { const p: R = new v42(x); p.a = x + 1; p.d = x + 2; return p; }
function f3219(x: number): R { const p: R = new (G42 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3220(x: number): R { const p: R = new (F42 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3221(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3222(x: number): R { const p: R = new v42(x); p.b = x + 1; p.a = x + 2; return p; }
function f3223(x: number): R { const p: R = new (G42 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3224(x: number): R { const p: R = new (F42 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3225(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3226(x: number): R { const p: R = new v42(x); p.b = x + 1; p.b = x + 2; return p; }
function f3227(x: number): R { const p: R = new (G42 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3228(x: number): R { const p: R = new (F42 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3229(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3230(x: number): R { const p: R = new v42(x); p.b = x + 1; p.c = x + 2; return p; }
function f3231(x: number): R { const p: R = new (G42 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3232(x: number): R { const p: R = new (F42 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3233(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3234(x: number): R { const p: R = new v42(x); p.b = x + 1; p.d = x + 2; return p; }
function f3235(x: number): R { const p: R = new (G42 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3236(x: number): R { const p: R = new (F42 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3237(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3238(x: number): R { const p: R = new v42(x); p.c = x + 1; p.a = x + 2; return p; }
function f3239(x: number): R { const p: R = new (G42 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3240(x: number): R { const p: R = new (F42 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3241(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3242(x: number): R { const p: R = new v42(x); p.c = x + 1; p.b = x + 2; return p; }
function f3243(x: number): R { const p: R = new (G42 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3244(x: number): R { const p: R = new (F42 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3245(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3246(x: number): R { const p: R = new v42(x); p.c = x + 1; p.c = x + 2; return p; }
function f3247(x: number): R { const p: R = new (G42 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3248(x: number): R { const p: R = new (F42 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3249(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3250(x: number): R { const p: R = new v42(x); p.c = x + 1; p.d = x + 2; return p; }
function f3251(x: number): R { const p: R = new (G42 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3252(x: number): R { const p: R = new (F42 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3253(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3254(x: number): R { const p: R = new v42(x); p.d = x + 1; p.a = x + 2; return p; }
function f3255(x: number): R { const p: R = new (G42 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3256(x: number): R { const p: R = new (F42 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3257(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3258(x: number): R { const p: R = new v42(x); p.d = x + 1; p.b = x + 2; return p; }
function f3259(x: number): R { const p: R = new (G42 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3260(x: number): R { const p: R = new (F42 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3261(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3262(x: number): R { const p: R = new v42(x); p.d = x + 1; p.c = x + 2; return p; }
function f3263(x: number): R { const p: R = new (G42 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3264(x: number): R { const p: R = new (F42 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3265(x: number): R { const p: R = new (F42 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3266(x: number): R { const p: R = new v42(x); p.d = x + 1; p.d = x + 2; return p; }
function f3267(x: number): R { const p: R = new (G42 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3268(x: number): R { const p: R = new (F43 as any)(x); p.a = x + 1; return p; }
function f3269(x: number): R { const p: R = new v43(x); p.a = x + 1; return p; }
function f3270(x: number): R { const p: R = new (G43 as any)(x); p.a = x + 1; return p; }
function f3271(x: number): R { const p: R = new (F43 as any)(x); p.b = x + 1; return p; }
function f3272(x: number): R { const p: R = new v43(x); p.b = x + 1; return p; }
function f3273(x: number): R { const p: R = new (G43 as any)(x); p.b = x + 1; return p; }
function f3274(x: number): R { const p: R = new (F43 as any)(x); p.c = x + 1; return p; }
function f3275(x: number): R { const p: R = new v43(x); p.c = x + 1; return p; }
function f3276(x: number): R { const p: R = new (G43 as any)(x); p.c = x + 1; return p; }
function f3277(x: number): R { const p: R = new (F43 as any)(x); p.d = x + 1; return p; }
function f3278(x: number): R { const p: R = new v43(x); p.d = x + 1; return p; }
function f3279(x: number): R { const p: R = new (G43 as any)(x); p.d = x + 1; return p; }
function f3280(x: number): R { const p: R = new (F43 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3281(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3282(x: number): R { const p: R = new v43(x); p.a = x + 1; p.a = x + 2; return p; }
function f3283(x: number): R { const p: R = new (G43 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3284(x: number): R { const p: R = new (F43 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3285(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3286(x: number): R { const p: R = new v43(x); p.a = x + 1; p.b = x + 2; return p; }
function f3287(x: number): R { const p: R = new (G43 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3288(x: number): R { const p: R = new (F43 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3289(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3290(x: number): R { const p: R = new v43(x); p.a = x + 1; p.c = x + 2; return p; }
function f3291(x: number): R { const p: R = new (G43 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3292(x: number): R { const p: R = new (F43 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3293(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3294(x: number): R { const p: R = new v43(x); p.a = x + 1; p.d = x + 2; return p; }
function f3295(x: number): R { const p: R = new (G43 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3296(x: number): R { const p: R = new (F43 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3297(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3298(x: number): R { const p: R = new v43(x); p.b = x + 1; p.a = x + 2; return p; }
function f3299(x: number): R { const p: R = new (G43 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3300(x: number): R { const p: R = new (F43 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3301(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3302(x: number): R { const p: R = new v43(x); p.b = x + 1; p.b = x + 2; return p; }
function f3303(x: number): R { const p: R = new (G43 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3304(x: number): R { const p: R = new (F43 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3305(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3306(x: number): R { const p: R = new v43(x); p.b = x + 1; p.c = x + 2; return p; }
function f3307(x: number): R { const p: R = new (G43 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3308(x: number): R { const p: R = new (F43 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3309(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3310(x: number): R { const p: R = new v43(x); p.b = x + 1; p.d = x + 2; return p; }
function f3311(x: number): R { const p: R = new (G43 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3312(x: number): R { const p: R = new (F43 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3313(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3314(x: number): R { const p: R = new v43(x); p.c = x + 1; p.a = x + 2; return p; }
function f3315(x: number): R { const p: R = new (G43 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3316(x: number): R { const p: R = new (F43 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3317(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3318(x: number): R { const p: R = new v43(x); p.c = x + 1; p.b = x + 2; return p; }
function f3319(x: number): R { const p: R = new (G43 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3320(x: number): R { const p: R = new (F43 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3321(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3322(x: number): R { const p: R = new v43(x); p.c = x + 1; p.c = x + 2; return p; }
function f3323(x: number): R { const p: R = new (G43 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3324(x: number): R { const p: R = new (F43 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3325(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3326(x: number): R { const p: R = new v43(x); p.c = x + 1; p.d = x + 2; return p; }
function f3327(x: number): R { const p: R = new (G43 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3328(x: number): R { const p: R = new (F43 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3329(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3330(x: number): R { const p: R = new v43(x); p.d = x + 1; p.a = x + 2; return p; }
function f3331(x: number): R { const p: R = new (G43 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3332(x: number): R { const p: R = new (F43 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3333(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3334(x: number): R { const p: R = new v43(x); p.d = x + 1; p.b = x + 2; return p; }
function f3335(x: number): R { const p: R = new (G43 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3336(x: number): R { const p: R = new (F43 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3337(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3338(x: number): R { const p: R = new v43(x); p.d = x + 1; p.c = x + 2; return p; }
function f3339(x: number): R { const p: R = new (G43 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3340(x: number): R { const p: R = new (F43 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3341(x: number): R { const p: R = new (F43 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3342(x: number): R { const p: R = new v43(x); p.d = x + 1; p.d = x + 2; return p; }
function f3343(x: number): R { const p: R = new (G43 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3344(x: number): R { const p: R = new (F44 as any)(x); p.a = x + 1; return p; }
function f3345(x: number): R { const p: R = new v44(x); p.a = x + 1; return p; }
function f3346(x: number): R { const p: R = new (G44 as any)(x); p.a = x + 1; return p; }
function f3347(x: number): R { const p: R = new (F44 as any)(x); p.b = x + 1; return p; }
function f3348(x: number): R { const p: R = new v44(x); p.b = x + 1; return p; }
function f3349(x: number): R { const p: R = new (G44 as any)(x); p.b = x + 1; return p; }
function f3350(x: number): R { const p: R = new (F44 as any)(x); p.c = x + 1; return p; }
function f3351(x: number): R { const p: R = new v44(x); p.c = x + 1; return p; }
function f3352(x: number): R { const p: R = new (G44 as any)(x); p.c = x + 1; return p; }
function f3353(x: number): R { const p: R = new (F44 as any)(x); p.d = x + 1; return p; }
function f3354(x: number): R { const p: R = new v44(x); p.d = x + 1; return p; }
function f3355(x: number): R { const p: R = new (G44 as any)(x); p.d = x + 1; return p; }
function f3356(x: number): R { const p: R = new (F44 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3357(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3358(x: number): R { const p: R = new v44(x); p.a = x + 1; p.a = x + 2; return p; }
function f3359(x: number): R { const p: R = new (G44 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3360(x: number): R { const p: R = new (F44 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3361(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3362(x: number): R { const p: R = new v44(x); p.a = x + 1; p.b = x + 2; return p; }
function f3363(x: number): R { const p: R = new (G44 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3364(x: number): R { const p: R = new (F44 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3365(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3366(x: number): R { const p: R = new v44(x); p.a = x + 1; p.c = x + 2; return p; }
function f3367(x: number): R { const p: R = new (G44 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3368(x: number): R { const p: R = new (F44 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3369(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3370(x: number): R { const p: R = new v44(x); p.a = x + 1; p.d = x + 2; return p; }
function f3371(x: number): R { const p: R = new (G44 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3372(x: number): R { const p: R = new (F44 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3373(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3374(x: number): R { const p: R = new v44(x); p.b = x + 1; p.a = x + 2; return p; }
function f3375(x: number): R { const p: R = new (G44 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3376(x: number): R { const p: R = new (F44 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3377(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3378(x: number): R { const p: R = new v44(x); p.b = x + 1; p.b = x + 2; return p; }
function f3379(x: number): R { const p: R = new (G44 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3380(x: number): R { const p: R = new (F44 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3381(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3382(x: number): R { const p: R = new v44(x); p.b = x + 1; p.c = x + 2; return p; }
function f3383(x: number): R { const p: R = new (G44 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3384(x: number): R { const p: R = new (F44 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3385(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3386(x: number): R { const p: R = new v44(x); p.b = x + 1; p.d = x + 2; return p; }
function f3387(x: number): R { const p: R = new (G44 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3388(x: number): R { const p: R = new (F44 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3389(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3390(x: number): R { const p: R = new v44(x); p.c = x + 1; p.a = x + 2; return p; }
function f3391(x: number): R { const p: R = new (G44 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3392(x: number): R { const p: R = new (F44 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3393(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3394(x: number): R { const p: R = new v44(x); p.c = x + 1; p.b = x + 2; return p; }
function f3395(x: number): R { const p: R = new (G44 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3396(x: number): R { const p: R = new (F44 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3397(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3398(x: number): R { const p: R = new v44(x); p.c = x + 1; p.c = x + 2; return p; }
function f3399(x: number): R { const p: R = new (G44 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3400(x: number): R { const p: R = new (F44 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3401(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3402(x: number): R { const p: R = new v44(x); p.c = x + 1; p.d = x + 2; return p; }
function f3403(x: number): R { const p: R = new (G44 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3404(x: number): R { const p: R = new (F44 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3405(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3406(x: number): R { const p: R = new v44(x); p.d = x + 1; p.a = x + 2; return p; }
function f3407(x: number): R { const p: R = new (G44 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3408(x: number): R { const p: R = new (F44 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3409(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3410(x: number): R { const p: R = new v44(x); p.d = x + 1; p.b = x + 2; return p; }
function f3411(x: number): R { const p: R = new (G44 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3412(x: number): R { const p: R = new (F44 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3413(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3414(x: number): R { const p: R = new v44(x); p.d = x + 1; p.c = x + 2; return p; }
function f3415(x: number): R { const p: R = new (G44 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3416(x: number): R { const p: R = new (F44 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3417(x: number): R { const p: R = new (F44 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3418(x: number): R { const p: R = new v44(x); p.d = x + 1; p.d = x + 2; return p; }
function f3419(x: number): R { const p: R = new (G44 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3420(x: number): R { const p: R = new (F45 as any)(x); p.a = x + 1; return p; }
function f3421(x: number): R { const p: R = new v45(x); p.a = x + 1; return p; }
function f3422(x: number): R { const p: R = new (G45 as any)(x); p.a = x + 1; return p; }
function f3423(x: number): R { const p: R = new (F45 as any)(x); p.b = x + 1; return p; }
function f3424(x: number): R { const p: R = new v45(x); p.b = x + 1; return p; }
function f3425(x: number): R { const p: R = new (G45 as any)(x); p.b = x + 1; return p; }
function f3426(x: number): R { const p: R = new (F45 as any)(x); p.c = x + 1; return p; }
function f3427(x: number): R { const p: R = new v45(x); p.c = x + 1; return p; }
function f3428(x: number): R { const p: R = new (G45 as any)(x); p.c = x + 1; return p; }
function f3429(x: number): R { const p: R = new (F45 as any)(x); p.d = x + 1; return p; }
function f3430(x: number): R { const p: R = new v45(x); p.d = x + 1; return p; }
function f3431(x: number): R { const p: R = new (G45 as any)(x); p.d = x + 1; return p; }
function f3432(x: number): R { const p: R = new (F45 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3433(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3434(x: number): R { const p: R = new v45(x); p.a = x + 1; p.a = x + 2; return p; }
function f3435(x: number): R { const p: R = new (G45 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3436(x: number): R { const p: R = new (F45 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3437(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3438(x: number): R { const p: R = new v45(x); p.a = x + 1; p.b = x + 2; return p; }
function f3439(x: number): R { const p: R = new (G45 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3440(x: number): R { const p: R = new (F45 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3441(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3442(x: number): R { const p: R = new v45(x); p.a = x + 1; p.c = x + 2; return p; }
function f3443(x: number): R { const p: R = new (G45 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3444(x: number): R { const p: R = new (F45 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3445(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3446(x: number): R { const p: R = new v45(x); p.a = x + 1; p.d = x + 2; return p; }
function f3447(x: number): R { const p: R = new (G45 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3448(x: number): R { const p: R = new (F45 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3449(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3450(x: number): R { const p: R = new v45(x); p.b = x + 1; p.a = x + 2; return p; }
function f3451(x: number): R { const p: R = new (G45 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3452(x: number): R { const p: R = new (F45 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3453(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3454(x: number): R { const p: R = new v45(x); p.b = x + 1; p.b = x + 2; return p; }
function f3455(x: number): R { const p: R = new (G45 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3456(x: number): R { const p: R = new (F45 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3457(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3458(x: number): R { const p: R = new v45(x); p.b = x + 1; p.c = x + 2; return p; }
function f3459(x: number): R { const p: R = new (G45 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3460(x: number): R { const p: R = new (F45 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3461(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3462(x: number): R { const p: R = new v45(x); p.b = x + 1; p.d = x + 2; return p; }
function f3463(x: number): R { const p: R = new (G45 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3464(x: number): R { const p: R = new (F45 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3465(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3466(x: number): R { const p: R = new v45(x); p.c = x + 1; p.a = x + 2; return p; }
function f3467(x: number): R { const p: R = new (G45 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3468(x: number): R { const p: R = new (F45 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3469(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3470(x: number): R { const p: R = new v45(x); p.c = x + 1; p.b = x + 2; return p; }
function f3471(x: number): R { const p: R = new (G45 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3472(x: number): R { const p: R = new (F45 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3473(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3474(x: number): R { const p: R = new v45(x); p.c = x + 1; p.c = x + 2; return p; }
function f3475(x: number): R { const p: R = new (G45 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3476(x: number): R { const p: R = new (F45 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3477(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3478(x: number): R { const p: R = new v45(x); p.c = x + 1; p.d = x + 2; return p; }
function f3479(x: number): R { const p: R = new (G45 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3480(x: number): R { const p: R = new (F45 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3481(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3482(x: number): R { const p: R = new v45(x); p.d = x + 1; p.a = x + 2; return p; }
function f3483(x: number): R { const p: R = new (G45 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3484(x: number): R { const p: R = new (F45 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3485(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3486(x: number): R { const p: R = new v45(x); p.d = x + 1; p.b = x + 2; return p; }
function f3487(x: number): R { const p: R = new (G45 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3488(x: number): R { const p: R = new (F45 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3489(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3490(x: number): R { const p: R = new v45(x); p.d = x + 1; p.c = x + 2; return p; }
function f3491(x: number): R { const p: R = new (G45 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3492(x: number): R { const p: R = new (F45 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3493(x: number): R { const p: R = new (F45 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3494(x: number): R { const p: R = new v45(x); p.d = x + 1; p.d = x + 2; return p; }
function f3495(x: number): R { const p: R = new (G45 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3496(x: number): R { const p: R = new (F46 as any)(x); p.a = x + 1; return p; }
function f3497(x: number): R { const p: R = new v46(x); p.a = x + 1; return p; }
function f3498(x: number): R { const p: R = new (G46 as any)(x); p.a = x + 1; return p; }
function f3499(x: number): R { const p: R = new (F46 as any)(x); p.b = x + 1; return p; }
function f3500(x: number): R { const p: R = new v46(x); p.b = x + 1; return p; }
function f3501(x: number): R { const p: R = new (G46 as any)(x); p.b = x + 1; return p; }
function f3502(x: number): R { const p: R = new (F46 as any)(x); p.c = x + 1; return p; }
function f3503(x: number): R { const p: R = new v46(x); p.c = x + 1; return p; }
function f3504(x: number): R { const p: R = new (G46 as any)(x); p.c = x + 1; return p; }
function f3505(x: number): R { const p: R = new (F46 as any)(x); p.d = x + 1; return p; }
function f3506(x: number): R { const p: R = new v46(x); p.d = x + 1; return p; }
function f3507(x: number): R { const p: R = new (G46 as any)(x); p.d = x + 1; return p; }
function f3508(x: number): R { const p: R = new (F46 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3509(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3510(x: number): R { const p: R = new v46(x); p.a = x + 1; p.a = x + 2; return p; }
function f3511(x: number): R { const p: R = new (G46 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3512(x: number): R { const p: R = new (F46 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3513(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3514(x: number): R { const p: R = new v46(x); p.a = x + 1; p.b = x + 2; return p; }
function f3515(x: number): R { const p: R = new (G46 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3516(x: number): R { const p: R = new (F46 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3517(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3518(x: number): R { const p: R = new v46(x); p.a = x + 1; p.c = x + 2; return p; }
function f3519(x: number): R { const p: R = new (G46 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3520(x: number): R { const p: R = new (F46 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3521(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3522(x: number): R { const p: R = new v46(x); p.a = x + 1; p.d = x + 2; return p; }
function f3523(x: number): R { const p: R = new (G46 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3524(x: number): R { const p: R = new (F46 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3525(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3526(x: number): R { const p: R = new v46(x); p.b = x + 1; p.a = x + 2; return p; }
function f3527(x: number): R { const p: R = new (G46 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3528(x: number): R { const p: R = new (F46 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3529(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3530(x: number): R { const p: R = new v46(x); p.b = x + 1; p.b = x + 2; return p; }
function f3531(x: number): R { const p: R = new (G46 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3532(x: number): R { const p: R = new (F46 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3533(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3534(x: number): R { const p: R = new v46(x); p.b = x + 1; p.c = x + 2; return p; }
function f3535(x: number): R { const p: R = new (G46 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3536(x: number): R { const p: R = new (F46 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3537(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3538(x: number): R { const p: R = new v46(x); p.b = x + 1; p.d = x + 2; return p; }
function f3539(x: number): R { const p: R = new (G46 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3540(x: number): R { const p: R = new (F46 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3541(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3542(x: number): R { const p: R = new v46(x); p.c = x + 1; p.a = x + 2; return p; }
function f3543(x: number): R { const p: R = new (G46 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3544(x: number): R { const p: R = new (F46 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3545(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3546(x: number): R { const p: R = new v46(x); p.c = x + 1; p.b = x + 2; return p; }
function f3547(x: number): R { const p: R = new (G46 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3548(x: number): R { const p: R = new (F46 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3549(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3550(x: number): R { const p: R = new v46(x); p.c = x + 1; p.c = x + 2; return p; }
function f3551(x: number): R { const p: R = new (G46 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3552(x: number): R { const p: R = new (F46 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3553(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3554(x: number): R { const p: R = new v46(x); p.c = x + 1; p.d = x + 2; return p; }
function f3555(x: number): R { const p: R = new (G46 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3556(x: number): R { const p: R = new (F46 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3557(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3558(x: number): R { const p: R = new v46(x); p.d = x + 1; p.a = x + 2; return p; }
function f3559(x: number): R { const p: R = new (G46 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3560(x: number): R { const p: R = new (F46 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3561(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3562(x: number): R { const p: R = new v46(x); p.d = x + 1; p.b = x + 2; return p; }
function f3563(x: number): R { const p: R = new (G46 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3564(x: number): R { const p: R = new (F46 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3565(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3566(x: number): R { const p: R = new v46(x); p.d = x + 1; p.c = x + 2; return p; }
function f3567(x: number): R { const p: R = new (G46 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3568(x: number): R { const p: R = new (F46 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3569(x: number): R { const p: R = new (F46 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3570(x: number): R { const p: R = new v46(x); p.d = x + 1; p.d = x + 2; return p; }
function f3571(x: number): R { const p: R = new (G46 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3572(x: number): R { const p: R = new (F47 as any)(x); p.a = x + 1; return p; }
function f3573(x: number): R { const p: R = new v47(x); p.a = x + 1; return p; }
function f3574(x: number): R { const p: R = new (G47 as any)(x); p.a = x + 1; return p; }
function f3575(x: number): R { const p: R = new (F47 as any)(x); p.b = x + 1; return p; }
function f3576(x: number): R { const p: R = new v47(x); p.b = x + 1; return p; }
function f3577(x: number): R { const p: R = new (G47 as any)(x); p.b = x + 1; return p; }
function f3578(x: number): R { const p: R = new (F47 as any)(x); p.c = x + 1; return p; }
function f3579(x: number): R { const p: R = new v47(x); p.c = x + 1; return p; }
function f3580(x: number): R { const p: R = new (G47 as any)(x); p.c = x + 1; return p; }
function f3581(x: number): R { const p: R = new (F47 as any)(x); p.d = x + 1; return p; }
function f3582(x: number): R { const p: R = new v47(x); p.d = x + 1; return p; }
function f3583(x: number): R { const p: R = new (G47 as any)(x); p.d = x + 1; return p; }
function f3584(x: number): R { const p: R = new (F47 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3585(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3586(x: number): R { const p: R = new v47(x); p.a = x + 1; p.a = x + 2; return p; }
function f3587(x: number): R { const p: R = new (G47 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3588(x: number): R { const p: R = new (F47 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3589(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3590(x: number): R { const p: R = new v47(x); p.a = x + 1; p.b = x + 2; return p; }
function f3591(x: number): R { const p: R = new (G47 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3592(x: number): R { const p: R = new (F47 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3593(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3594(x: number): R { const p: R = new v47(x); p.a = x + 1; p.c = x + 2; return p; }
function f3595(x: number): R { const p: R = new (G47 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3596(x: number): R { const p: R = new (F47 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3597(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3598(x: number): R { const p: R = new v47(x); p.a = x + 1; p.d = x + 2; return p; }
function f3599(x: number): R { const p: R = new (G47 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3600(x: number): R { const p: R = new (F47 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3601(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3602(x: number): R { const p: R = new v47(x); p.b = x + 1; p.a = x + 2; return p; }
function f3603(x: number): R { const p: R = new (G47 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3604(x: number): R { const p: R = new (F47 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3605(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3606(x: number): R { const p: R = new v47(x); p.b = x + 1; p.b = x + 2; return p; }
function f3607(x: number): R { const p: R = new (G47 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3608(x: number): R { const p: R = new (F47 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3609(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3610(x: number): R { const p: R = new v47(x); p.b = x + 1; p.c = x + 2; return p; }
function f3611(x: number): R { const p: R = new (G47 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3612(x: number): R { const p: R = new (F47 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3613(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3614(x: number): R { const p: R = new v47(x); p.b = x + 1; p.d = x + 2; return p; }
function f3615(x: number): R { const p: R = new (G47 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3616(x: number): R { const p: R = new (F47 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3617(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3618(x: number): R { const p: R = new v47(x); p.c = x + 1; p.a = x + 2; return p; }
function f3619(x: number): R { const p: R = new (G47 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3620(x: number): R { const p: R = new (F47 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3621(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3622(x: number): R { const p: R = new v47(x); p.c = x + 1; p.b = x + 2; return p; }
function f3623(x: number): R { const p: R = new (G47 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3624(x: number): R { const p: R = new (F47 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3625(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3626(x: number): R { const p: R = new v47(x); p.c = x + 1; p.c = x + 2; return p; }
function f3627(x: number): R { const p: R = new (G47 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3628(x: number): R { const p: R = new (F47 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3629(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3630(x: number): R { const p: R = new v47(x); p.c = x + 1; p.d = x + 2; return p; }
function f3631(x: number): R { const p: R = new (G47 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3632(x: number): R { const p: R = new (F47 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3633(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3634(x: number): R { const p: R = new v47(x); p.d = x + 1; p.a = x + 2; return p; }
function f3635(x: number): R { const p: R = new (G47 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3636(x: number): R { const p: R = new (F47 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3637(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3638(x: number): R { const p: R = new v47(x); p.d = x + 1; p.b = x + 2; return p; }
function f3639(x: number): R { const p: R = new (G47 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3640(x: number): R { const p: R = new (F47 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3641(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3642(x: number): R { const p: R = new v47(x); p.d = x + 1; p.c = x + 2; return p; }
function f3643(x: number): R { const p: R = new (G47 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3644(x: number): R { const p: R = new (F47 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3645(x: number): R { const p: R = new (F47 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3646(x: number): R { const p: R = new v47(x); p.d = x + 1; p.d = x + 2; return p; }
function f3647(x: number): R { const p: R = new (G47 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3648(x: number): R { const p: R = new (F48 as any)(x); p.a = x + 1; return p; }
function f3649(x: number): R { const p: R = new v48(x); p.a = x + 1; return p; }
function f3650(x: number): R { const p: R = new (G48 as any)(x); p.a = x + 1; return p; }
function f3651(x: number): R { const p: R = new (F48 as any)(x); p.b = x + 1; return p; }
function f3652(x: number): R { const p: R = new v48(x); p.b = x + 1; return p; }
function f3653(x: number): R { const p: R = new (G48 as any)(x); p.b = x + 1; return p; }
function f3654(x: number): R { const p: R = new (F48 as any)(x); p.c = x + 1; return p; }
function f3655(x: number): R { const p: R = new v48(x); p.c = x + 1; return p; }
function f3656(x: number): R { const p: R = new (G48 as any)(x); p.c = x + 1; return p; }
function f3657(x: number): R { const p: R = new (F48 as any)(x); p.d = x + 1; return p; }
function f3658(x: number): R { const p: R = new v48(x); p.d = x + 1; return p; }
function f3659(x: number): R { const p: R = new (G48 as any)(x); p.d = x + 1; return p; }
function f3660(x: number): R { const p: R = new (F48 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3661(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3662(x: number): R { const p: R = new v48(x); p.a = x + 1; p.a = x + 2; return p; }
function f3663(x: number): R { const p: R = new (G48 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3664(x: number): R { const p: R = new (F48 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3665(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3666(x: number): R { const p: R = new v48(x); p.a = x + 1; p.b = x + 2; return p; }
function f3667(x: number): R { const p: R = new (G48 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3668(x: number): R { const p: R = new (F48 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3669(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3670(x: number): R { const p: R = new v48(x); p.a = x + 1; p.c = x + 2; return p; }
function f3671(x: number): R { const p: R = new (G48 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3672(x: number): R { const p: R = new (F48 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3673(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3674(x: number): R { const p: R = new v48(x); p.a = x + 1; p.d = x + 2; return p; }
function f3675(x: number): R { const p: R = new (G48 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3676(x: number): R { const p: R = new (F48 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3677(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3678(x: number): R { const p: R = new v48(x); p.b = x + 1; p.a = x + 2; return p; }
function f3679(x: number): R { const p: R = new (G48 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3680(x: number): R { const p: R = new (F48 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3681(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3682(x: number): R { const p: R = new v48(x); p.b = x + 1; p.b = x + 2; return p; }
function f3683(x: number): R { const p: R = new (G48 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3684(x: number): R { const p: R = new (F48 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3685(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3686(x: number): R { const p: R = new v48(x); p.b = x + 1; p.c = x + 2; return p; }
function f3687(x: number): R { const p: R = new (G48 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3688(x: number): R { const p: R = new (F48 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3689(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3690(x: number): R { const p: R = new v48(x); p.b = x + 1; p.d = x + 2; return p; }
function f3691(x: number): R { const p: R = new (G48 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3692(x: number): R { const p: R = new (F48 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3693(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3694(x: number): R { const p: R = new v48(x); p.c = x + 1; p.a = x + 2; return p; }
function f3695(x: number): R { const p: R = new (G48 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3696(x: number): R { const p: R = new (F48 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3697(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3698(x: number): R { const p: R = new v48(x); p.c = x + 1; p.b = x + 2; return p; }
function f3699(x: number): R { const p: R = new (G48 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3700(x: number): R { const p: R = new (F48 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3701(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3702(x: number): R { const p: R = new v48(x); p.c = x + 1; p.c = x + 2; return p; }
function f3703(x: number): R { const p: R = new (G48 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3704(x: number): R { const p: R = new (F48 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3705(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3706(x: number): R { const p: R = new v48(x); p.c = x + 1; p.d = x + 2; return p; }
function f3707(x: number): R { const p: R = new (G48 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3708(x: number): R { const p: R = new (F48 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3709(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3710(x: number): R { const p: R = new v48(x); p.d = x + 1; p.a = x + 2; return p; }
function f3711(x: number): R { const p: R = new (G48 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3712(x: number): R { const p: R = new (F48 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3713(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3714(x: number): R { const p: R = new v48(x); p.d = x + 1; p.b = x + 2; return p; }
function f3715(x: number): R { const p: R = new (G48 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3716(x: number): R { const p: R = new (F48 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3717(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3718(x: number): R { const p: R = new v48(x); p.d = x + 1; p.c = x + 2; return p; }
function f3719(x: number): R { const p: R = new (G48 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3720(x: number): R { const p: R = new (F48 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3721(x: number): R { const p: R = new (F48 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3722(x: number): R { const p: R = new v48(x); p.d = x + 1; p.d = x + 2; return p; }
function f3723(x: number): R { const p: R = new (G48 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3724(x: number): R { const p: R = new (F49 as any)(x); p.a = x + 1; return p; }
function f3725(x: number): R { const p: R = new v49(x); p.a = x + 1; return p; }
function f3726(x: number): R { const p: R = new (G49 as any)(x); p.a = x + 1; return p; }
function f3727(x: number): R { const p: R = new (F49 as any)(x); p.b = x + 1; return p; }
function f3728(x: number): R { const p: R = new v49(x); p.b = x + 1; return p; }
function f3729(x: number): R { const p: R = new (G49 as any)(x); p.b = x + 1; return p; }
function f3730(x: number): R { const p: R = new (F49 as any)(x); p.c = x + 1; return p; }
function f3731(x: number): R { const p: R = new v49(x); p.c = x + 1; return p; }
function f3732(x: number): R { const p: R = new (G49 as any)(x); p.c = x + 1; return p; }
function f3733(x: number): R { const p: R = new (F49 as any)(x); p.d = x + 1; return p; }
function f3734(x: number): R { const p: R = new v49(x); p.d = x + 1; return p; }
function f3735(x: number): R { const p: R = new (G49 as any)(x); p.d = x + 1; return p; }
function f3736(x: number): R { const p: R = new (F49 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3737(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3738(x: number): R { const p: R = new v49(x); p.a = x + 1; p.a = x + 2; return p; }
function f3739(x: number): R { const p: R = new (G49 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3740(x: number): R { const p: R = new (F49 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3741(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3742(x: number): R { const p: R = new v49(x); p.a = x + 1; p.b = x + 2; return p; }
function f3743(x: number): R { const p: R = new (G49 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3744(x: number): R { const p: R = new (F49 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3745(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3746(x: number): R { const p: R = new v49(x); p.a = x + 1; p.c = x + 2; return p; }
function f3747(x: number): R { const p: R = new (G49 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3748(x: number): R { const p: R = new (F49 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3749(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3750(x: number): R { const p: R = new v49(x); p.a = x + 1; p.d = x + 2; return p; }
function f3751(x: number): R { const p: R = new (G49 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3752(x: number): R { const p: R = new (F49 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3753(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3754(x: number): R { const p: R = new v49(x); p.b = x + 1; p.a = x + 2; return p; }
function f3755(x: number): R { const p: R = new (G49 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3756(x: number): R { const p: R = new (F49 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3757(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3758(x: number): R { const p: R = new v49(x); p.b = x + 1; p.b = x + 2; return p; }
function f3759(x: number): R { const p: R = new (G49 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3760(x: number): R { const p: R = new (F49 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3761(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3762(x: number): R { const p: R = new v49(x); p.b = x + 1; p.c = x + 2; return p; }
function f3763(x: number): R { const p: R = new (G49 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3764(x: number): R { const p: R = new (F49 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3765(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3766(x: number): R { const p: R = new v49(x); p.b = x + 1; p.d = x + 2; return p; }
function f3767(x: number): R { const p: R = new (G49 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3768(x: number): R { const p: R = new (F49 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3769(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3770(x: number): R { const p: R = new v49(x); p.c = x + 1; p.a = x + 2; return p; }
function f3771(x: number): R { const p: R = new (G49 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3772(x: number): R { const p: R = new (F49 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3773(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3774(x: number): R { const p: R = new v49(x); p.c = x + 1; p.b = x + 2; return p; }
function f3775(x: number): R { const p: R = new (G49 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3776(x: number): R { const p: R = new (F49 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3777(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3778(x: number): R { const p: R = new v49(x); p.c = x + 1; p.c = x + 2; return p; }
function f3779(x: number): R { const p: R = new (G49 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3780(x: number): R { const p: R = new (F49 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3781(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3782(x: number): R { const p: R = new v49(x); p.c = x + 1; p.d = x + 2; return p; }
function f3783(x: number): R { const p: R = new (G49 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3784(x: number): R { const p: R = new (F49 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3785(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3786(x: number): R { const p: R = new v49(x); p.d = x + 1; p.a = x + 2; return p; }
function f3787(x: number): R { const p: R = new (G49 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3788(x: number): R { const p: R = new (F49 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3789(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3790(x: number): R { const p: R = new v49(x); p.d = x + 1; p.b = x + 2; return p; }
function f3791(x: number): R { const p: R = new (G49 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3792(x: number): R { const p: R = new (F49 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3793(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3794(x: number): R { const p: R = new v49(x); p.d = x + 1; p.c = x + 2; return p; }
function f3795(x: number): R { const p: R = new (G49 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3796(x: number): R { const p: R = new (F49 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3797(x: number): R { const p: R = new (F49 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3798(x: number): R { const p: R = new v49(x); p.d = x + 1; p.d = x + 2; return p; }
function f3799(x: number): R { const p: R = new (G49 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3800(x: number): R { const p: R = new (F50 as any)(x); p.a = x + 1; return p; }
function f3801(x: number): R { const p: R = new v50(x); p.a = x + 1; return p; }
function f3802(x: number): R { const p: R = new (G50 as any)(x); p.a = x + 1; return p; }
function f3803(x: number): R { const p: R = new (F50 as any)(x); p.b = x + 1; return p; }
function f3804(x: number): R { const p: R = new v50(x); p.b = x + 1; return p; }
function f3805(x: number): R { const p: R = new (G50 as any)(x); p.b = x + 1; return p; }
function f3806(x: number): R { const p: R = new (F50 as any)(x); p.c = x + 1; return p; }
function f3807(x: number): R { const p: R = new v50(x); p.c = x + 1; return p; }
function f3808(x: number): R { const p: R = new (G50 as any)(x); p.c = x + 1; return p; }
function f3809(x: number): R { const p: R = new (F50 as any)(x); p.d = x + 1; return p; }
function f3810(x: number): R { const p: R = new v50(x); p.d = x + 1; return p; }
function f3811(x: number): R { const p: R = new (G50 as any)(x); p.d = x + 1; return p; }
function f3812(x: number): R { const p: R = new (F50 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3813(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3814(x: number): R { const p: R = new v50(x); p.a = x + 1; p.a = x + 2; return p; }
function f3815(x: number): R { const p: R = new (G50 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3816(x: number): R { const p: R = new (F50 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3817(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3818(x: number): R { const p: R = new v50(x); p.a = x + 1; p.b = x + 2; return p; }
function f3819(x: number): R { const p: R = new (G50 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3820(x: number): R { const p: R = new (F50 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3821(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3822(x: number): R { const p: R = new v50(x); p.a = x + 1; p.c = x + 2; return p; }
function f3823(x: number): R { const p: R = new (G50 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3824(x: number): R { const p: R = new (F50 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3825(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3826(x: number): R { const p: R = new v50(x); p.a = x + 1; p.d = x + 2; return p; }
function f3827(x: number): R { const p: R = new (G50 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3828(x: number): R { const p: R = new (F50 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3829(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3830(x: number): R { const p: R = new v50(x); p.b = x + 1; p.a = x + 2; return p; }
function f3831(x: number): R { const p: R = new (G50 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3832(x: number): R { const p: R = new (F50 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3833(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3834(x: number): R { const p: R = new v50(x); p.b = x + 1; p.b = x + 2; return p; }
function f3835(x: number): R { const p: R = new (G50 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3836(x: number): R { const p: R = new (F50 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3837(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3838(x: number): R { const p: R = new v50(x); p.b = x + 1; p.c = x + 2; return p; }
function f3839(x: number): R { const p: R = new (G50 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3840(x: number): R { const p: R = new (F50 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3841(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3842(x: number): R { const p: R = new v50(x); p.b = x + 1; p.d = x + 2; return p; }
function f3843(x: number): R { const p: R = new (G50 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3844(x: number): R { const p: R = new (F50 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3845(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3846(x: number): R { const p: R = new v50(x); p.c = x + 1; p.a = x + 2; return p; }
function f3847(x: number): R { const p: R = new (G50 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3848(x: number): R { const p: R = new (F50 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3849(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3850(x: number): R { const p: R = new v50(x); p.c = x + 1; p.b = x + 2; return p; }
function f3851(x: number): R { const p: R = new (G50 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3852(x: number): R { const p: R = new (F50 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3853(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3854(x: number): R { const p: R = new v50(x); p.c = x + 1; p.c = x + 2; return p; }
function f3855(x: number): R { const p: R = new (G50 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3856(x: number): R { const p: R = new (F50 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3857(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3858(x: number): R { const p: R = new v50(x); p.c = x + 1; p.d = x + 2; return p; }
function f3859(x: number): R { const p: R = new (G50 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3860(x: number): R { const p: R = new (F50 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3861(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3862(x: number): R { const p: R = new v50(x); p.d = x + 1; p.a = x + 2; return p; }
function f3863(x: number): R { const p: R = new (G50 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3864(x: number): R { const p: R = new (F50 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3865(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3866(x: number): R { const p: R = new v50(x); p.d = x + 1; p.b = x + 2; return p; }
function f3867(x: number): R { const p: R = new (G50 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3868(x: number): R { const p: R = new (F50 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3869(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3870(x: number): R { const p: R = new v50(x); p.d = x + 1; p.c = x + 2; return p; }
function f3871(x: number): R { const p: R = new (G50 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3872(x: number): R { const p: R = new (F50 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3873(x: number): R { const p: R = new (F50 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3874(x: number): R { const p: R = new v50(x); p.d = x + 1; p.d = x + 2; return p; }
function f3875(x: number): R { const p: R = new (G50 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3876(x: number): R { const p: R = new (F51 as any)(x); p.a = x + 1; return p; }
function f3877(x: number): R { const p: R = new v51(x); p.a = x + 1; return p; }
function f3878(x: number): R { const p: R = new (G51 as any)(x); p.a = x + 1; return p; }
function f3879(x: number): R { const p: R = new (F51 as any)(x); p.b = x + 1; return p; }
function f3880(x: number): R { const p: R = new v51(x); p.b = x + 1; return p; }
function f3881(x: number): R { const p: R = new (G51 as any)(x); p.b = x + 1; return p; }
function f3882(x: number): R { const p: R = new (F51 as any)(x); p.c = x + 1; return p; }
function f3883(x: number): R { const p: R = new v51(x); p.c = x + 1; return p; }
function f3884(x: number): R { const p: R = new (G51 as any)(x); p.c = x + 1; return p; }
function f3885(x: number): R { const p: R = new (F51 as any)(x); p.d = x + 1; return p; }
function f3886(x: number): R { const p: R = new v51(x); p.d = x + 1; return p; }
function f3887(x: number): R { const p: R = new (G51 as any)(x); p.d = x + 1; return p; }
function f3888(x: number): R { const p: R = new (F51 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3889(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3890(x: number): R { const p: R = new v51(x); p.a = x + 1; p.a = x + 2; return p; }
function f3891(x: number): R { const p: R = new (G51 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3892(x: number): R { const p: R = new (F51 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3893(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3894(x: number): R { const p: R = new v51(x); p.a = x + 1; p.b = x + 2; return p; }
function f3895(x: number): R { const p: R = new (G51 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3896(x: number): R { const p: R = new (F51 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3897(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3898(x: number): R { const p: R = new v51(x); p.a = x + 1; p.c = x + 2; return p; }
function f3899(x: number): R { const p: R = new (G51 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3900(x: number): R { const p: R = new (F51 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3901(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3902(x: number): R { const p: R = new v51(x); p.a = x + 1; p.d = x + 2; return p; }
function f3903(x: number): R { const p: R = new (G51 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3904(x: number): R { const p: R = new (F51 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3905(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3906(x: number): R { const p: R = new v51(x); p.b = x + 1; p.a = x + 2; return p; }
function f3907(x: number): R { const p: R = new (G51 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3908(x: number): R { const p: R = new (F51 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3909(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3910(x: number): R { const p: R = new v51(x); p.b = x + 1; p.b = x + 2; return p; }
function f3911(x: number): R { const p: R = new (G51 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3912(x: number): R { const p: R = new (F51 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3913(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3914(x: number): R { const p: R = new v51(x); p.b = x + 1; p.c = x + 2; return p; }
function f3915(x: number): R { const p: R = new (G51 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3916(x: number): R { const p: R = new (F51 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3917(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3918(x: number): R { const p: R = new v51(x); p.b = x + 1; p.d = x + 2; return p; }
function f3919(x: number): R { const p: R = new (G51 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3920(x: number): R { const p: R = new (F51 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3921(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3922(x: number): R { const p: R = new v51(x); p.c = x + 1; p.a = x + 2; return p; }
function f3923(x: number): R { const p: R = new (G51 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3924(x: number): R { const p: R = new (F51 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3925(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f3926(x: number): R { const p: R = new v51(x); p.c = x + 1; p.b = x + 2; return p; }
function f3927(x: number): R { const p: R = new (G51 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f3928(x: number): R { const p: R = new (F51 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3929(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f3930(x: number): R { const p: R = new v51(x); p.c = x + 1; p.c = x + 2; return p; }
function f3931(x: number): R { const p: R = new (G51 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f3932(x: number): R { const p: R = new (F51 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3933(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f3934(x: number): R { const p: R = new v51(x); p.c = x + 1; p.d = x + 2; return p; }
function f3935(x: number): R { const p: R = new (G51 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f3936(x: number): R { const p: R = new (F51 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3937(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f3938(x: number): R { const p: R = new v51(x); p.d = x + 1; p.a = x + 2; return p; }
function f3939(x: number): R { const p: R = new (G51 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f3940(x: number): R { const p: R = new (F51 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3941(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f3942(x: number): R { const p: R = new v51(x); p.d = x + 1; p.b = x + 2; return p; }
function f3943(x: number): R { const p: R = new (G51 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f3944(x: number): R { const p: R = new (F51 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3945(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f3946(x: number): R { const p: R = new v51(x); p.d = x + 1; p.c = x + 2; return p; }
function f3947(x: number): R { const p: R = new (G51 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f3948(x: number): R { const p: R = new (F51 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3949(x: number): R { const p: R = new (F51 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f3950(x: number): R { const p: R = new v51(x); p.d = x + 1; p.d = x + 2; return p; }
function f3951(x: number): R { const p: R = new (G51 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f3952(x: number): R { const p: R = new (F52 as any)(x); p.a = x + 1; return p; }
function f3953(x: number): R { const p: R = new v52(x); p.a = x + 1; return p; }
function f3954(x: number): R { const p: R = new (G52 as any)(x); p.a = x + 1; return p; }
function f3955(x: number): R { const p: R = new (F52 as any)(x); p.b = x + 1; return p; }
function f3956(x: number): R { const p: R = new v52(x); p.b = x + 1; return p; }
function f3957(x: number): R { const p: R = new (G52 as any)(x); p.b = x + 1; return p; }
function f3958(x: number): R { const p: R = new (F52 as any)(x); p.c = x + 1; return p; }
function f3959(x: number): R { const p: R = new v52(x); p.c = x + 1; return p; }
function f3960(x: number): R { const p: R = new (G52 as any)(x); p.c = x + 1; return p; }
function f3961(x: number): R { const p: R = new (F52 as any)(x); p.d = x + 1; return p; }
function f3962(x: number): R { const p: R = new v52(x); p.d = x + 1; return p; }
function f3963(x: number): R { const p: R = new (G52 as any)(x); p.d = x + 1; return p; }
function f3964(x: number): R { const p: R = new (F52 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3965(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f3966(x: number): R { const p: R = new v52(x); p.a = x + 1; p.a = x + 2; return p; }
function f3967(x: number): R { const p: R = new (G52 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f3968(x: number): R { const p: R = new (F52 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3969(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f3970(x: number): R { const p: R = new v52(x); p.a = x + 1; p.b = x + 2; return p; }
function f3971(x: number): R { const p: R = new (G52 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f3972(x: number): R { const p: R = new (F52 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3973(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f3974(x: number): R { const p: R = new v52(x); p.a = x + 1; p.c = x + 2; return p; }
function f3975(x: number): R { const p: R = new (G52 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f3976(x: number): R { const p: R = new (F52 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3977(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f3978(x: number): R { const p: R = new v52(x); p.a = x + 1; p.d = x + 2; return p; }
function f3979(x: number): R { const p: R = new (G52 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f3980(x: number): R { const p: R = new (F52 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3981(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f3982(x: number): R { const p: R = new v52(x); p.b = x + 1; p.a = x + 2; return p; }
function f3983(x: number): R { const p: R = new (G52 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f3984(x: number): R { const p: R = new (F52 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3985(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f3986(x: number): R { const p: R = new v52(x); p.b = x + 1; p.b = x + 2; return p; }
function f3987(x: number): R { const p: R = new (G52 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f3988(x: number): R { const p: R = new (F52 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3989(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f3990(x: number): R { const p: R = new v52(x); p.b = x + 1; p.c = x + 2; return p; }
function f3991(x: number): R { const p: R = new (G52 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f3992(x: number): R { const p: R = new (F52 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3993(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f3994(x: number): R { const p: R = new v52(x); p.b = x + 1; p.d = x + 2; return p; }
function f3995(x: number): R { const p: R = new (G52 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f3996(x: number): R { const p: R = new (F52 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f3997(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f3998(x: number): R { const p: R = new v52(x); p.c = x + 1; p.a = x + 2; return p; }
function f3999(x: number): R { const p: R = new (G52 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4000(x: number): R { const p: R = new (F52 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4001(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4002(x: number): R { const p: R = new v52(x); p.c = x + 1; p.b = x + 2; return p; }
function f4003(x: number): R { const p: R = new (G52 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4004(x: number): R { const p: R = new (F52 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4005(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4006(x: number): R { const p: R = new v52(x); p.c = x + 1; p.c = x + 2; return p; }
function f4007(x: number): R { const p: R = new (G52 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4008(x: number): R { const p: R = new (F52 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4009(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4010(x: number): R { const p: R = new v52(x); p.c = x + 1; p.d = x + 2; return p; }
function f4011(x: number): R { const p: R = new (G52 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4012(x: number): R { const p: R = new (F52 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4013(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4014(x: number): R { const p: R = new v52(x); p.d = x + 1; p.a = x + 2; return p; }
function f4015(x: number): R { const p: R = new (G52 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4016(x: number): R { const p: R = new (F52 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4017(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4018(x: number): R { const p: R = new v52(x); p.d = x + 1; p.b = x + 2; return p; }
function f4019(x: number): R { const p: R = new (G52 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4020(x: number): R { const p: R = new (F52 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4021(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4022(x: number): R { const p: R = new v52(x); p.d = x + 1; p.c = x + 2; return p; }
function f4023(x: number): R { const p: R = new (G52 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4024(x: number): R { const p: R = new (F52 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4025(x: number): R { const p: R = new (F52 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4026(x: number): R { const p: R = new v52(x); p.d = x + 1; p.d = x + 2; return p; }
function f4027(x: number): R { const p: R = new (G52 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4028(x: number): R { const p: R = new (F53 as any)(x); p.a = x + 1; return p; }
function f4029(x: number): R { const p: R = new v53(x); p.a = x + 1; return p; }
function f4030(x: number): R { const p: R = new (G53 as any)(x); p.a = x + 1; return p; }
function f4031(x: number): R { const p: R = new (F53 as any)(x); p.b = x + 1; return p; }
function f4032(x: number): R { const p: R = new v53(x); p.b = x + 1; return p; }
function f4033(x: number): R { const p: R = new (G53 as any)(x); p.b = x + 1; return p; }
function f4034(x: number): R { const p: R = new (F53 as any)(x); p.c = x + 1; return p; }
function f4035(x: number): R { const p: R = new v53(x); p.c = x + 1; return p; }
function f4036(x: number): R { const p: R = new (G53 as any)(x); p.c = x + 1; return p; }
function f4037(x: number): R { const p: R = new (F53 as any)(x); p.d = x + 1; return p; }
function f4038(x: number): R { const p: R = new v53(x); p.d = x + 1; return p; }
function f4039(x: number): R { const p: R = new (G53 as any)(x); p.d = x + 1; return p; }
function f4040(x: number): R { const p: R = new (F53 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4041(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4042(x: number): R { const p: R = new v53(x); p.a = x + 1; p.a = x + 2; return p; }
function f4043(x: number): R { const p: R = new (G53 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4044(x: number): R { const p: R = new (F53 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4045(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4046(x: number): R { const p: R = new v53(x); p.a = x + 1; p.b = x + 2; return p; }
function f4047(x: number): R { const p: R = new (G53 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4048(x: number): R { const p: R = new (F53 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4049(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4050(x: number): R { const p: R = new v53(x); p.a = x + 1; p.c = x + 2; return p; }
function f4051(x: number): R { const p: R = new (G53 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4052(x: number): R { const p: R = new (F53 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4053(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4054(x: number): R { const p: R = new v53(x); p.a = x + 1; p.d = x + 2; return p; }
function f4055(x: number): R { const p: R = new (G53 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4056(x: number): R { const p: R = new (F53 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4057(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4058(x: number): R { const p: R = new v53(x); p.b = x + 1; p.a = x + 2; return p; }
function f4059(x: number): R { const p: R = new (G53 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4060(x: number): R { const p: R = new (F53 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4061(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4062(x: number): R { const p: R = new v53(x); p.b = x + 1; p.b = x + 2; return p; }
function f4063(x: number): R { const p: R = new (G53 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4064(x: number): R { const p: R = new (F53 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4065(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4066(x: number): R { const p: R = new v53(x); p.b = x + 1; p.c = x + 2; return p; }
function f4067(x: number): R { const p: R = new (G53 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4068(x: number): R { const p: R = new (F53 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4069(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4070(x: number): R { const p: R = new v53(x); p.b = x + 1; p.d = x + 2; return p; }
function f4071(x: number): R { const p: R = new (G53 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4072(x: number): R { const p: R = new (F53 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4073(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4074(x: number): R { const p: R = new v53(x); p.c = x + 1; p.a = x + 2; return p; }
function f4075(x: number): R { const p: R = new (G53 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4076(x: number): R { const p: R = new (F53 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4077(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4078(x: number): R { const p: R = new v53(x); p.c = x + 1; p.b = x + 2; return p; }
function f4079(x: number): R { const p: R = new (G53 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4080(x: number): R { const p: R = new (F53 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4081(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4082(x: number): R { const p: R = new v53(x); p.c = x + 1; p.c = x + 2; return p; }
function f4083(x: number): R { const p: R = new (G53 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4084(x: number): R { const p: R = new (F53 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4085(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4086(x: number): R { const p: R = new v53(x); p.c = x + 1; p.d = x + 2; return p; }
function f4087(x: number): R { const p: R = new (G53 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4088(x: number): R { const p: R = new (F53 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4089(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4090(x: number): R { const p: R = new v53(x); p.d = x + 1; p.a = x + 2; return p; }
function f4091(x: number): R { const p: R = new (G53 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4092(x: number): R { const p: R = new (F53 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4093(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4094(x: number): R { const p: R = new v53(x); p.d = x + 1; p.b = x + 2; return p; }
function f4095(x: number): R { const p: R = new (G53 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4096(x: number): R { const p: R = new (F53 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4097(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4098(x: number): R { const p: R = new v53(x); p.d = x + 1; p.c = x + 2; return p; }
function f4099(x: number): R { const p: R = new (G53 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4100(x: number): R { const p: R = new (F53 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4101(x: number): R { const p: R = new (F53 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4102(x: number): R { const p: R = new v53(x); p.d = x + 1; p.d = x + 2; return p; }
function f4103(x: number): R { const p: R = new (G53 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4104(x: number): R { const p: R = new (F54 as any)(x); p.a = x + 1; return p; }
function f4105(x: number): R { const p: R = new v54(x); p.a = x + 1; return p; }
function f4106(x: number): R { const p: R = new (G54 as any)(x); p.a = x + 1; return p; }
function f4107(x: number): R { const p: R = new (F54 as any)(x); p.b = x + 1; return p; }
function f4108(x: number): R { const p: R = new v54(x); p.b = x + 1; return p; }
function f4109(x: number): R { const p: R = new (G54 as any)(x); p.b = x + 1; return p; }
function f4110(x: number): R { const p: R = new (F54 as any)(x); p.c = x + 1; return p; }
function f4111(x: number): R { const p: R = new v54(x); p.c = x + 1; return p; }
function f4112(x: number): R { const p: R = new (G54 as any)(x); p.c = x + 1; return p; }
function f4113(x: number): R { const p: R = new (F54 as any)(x); p.d = x + 1; return p; }
function f4114(x: number): R { const p: R = new v54(x); p.d = x + 1; return p; }
function f4115(x: number): R { const p: R = new (G54 as any)(x); p.d = x + 1; return p; }
function f4116(x: number): R { const p: R = new (F54 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4117(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4118(x: number): R { const p: R = new v54(x); p.a = x + 1; p.a = x + 2; return p; }
function f4119(x: number): R { const p: R = new (G54 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4120(x: number): R { const p: R = new (F54 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4121(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4122(x: number): R { const p: R = new v54(x); p.a = x + 1; p.b = x + 2; return p; }
function f4123(x: number): R { const p: R = new (G54 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4124(x: number): R { const p: R = new (F54 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4125(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4126(x: number): R { const p: R = new v54(x); p.a = x + 1; p.c = x + 2; return p; }
function f4127(x: number): R { const p: R = new (G54 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4128(x: number): R { const p: R = new (F54 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4129(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4130(x: number): R { const p: R = new v54(x); p.a = x + 1; p.d = x + 2; return p; }
function f4131(x: number): R { const p: R = new (G54 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4132(x: number): R { const p: R = new (F54 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4133(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4134(x: number): R { const p: R = new v54(x); p.b = x + 1; p.a = x + 2; return p; }
function f4135(x: number): R { const p: R = new (G54 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4136(x: number): R { const p: R = new (F54 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4137(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4138(x: number): R { const p: R = new v54(x); p.b = x + 1; p.b = x + 2; return p; }
function f4139(x: number): R { const p: R = new (G54 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4140(x: number): R { const p: R = new (F54 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4141(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4142(x: number): R { const p: R = new v54(x); p.b = x + 1; p.c = x + 2; return p; }
function f4143(x: number): R { const p: R = new (G54 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4144(x: number): R { const p: R = new (F54 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4145(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4146(x: number): R { const p: R = new v54(x); p.b = x + 1; p.d = x + 2; return p; }
function f4147(x: number): R { const p: R = new (G54 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4148(x: number): R { const p: R = new (F54 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4149(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4150(x: number): R { const p: R = new v54(x); p.c = x + 1; p.a = x + 2; return p; }
function f4151(x: number): R { const p: R = new (G54 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4152(x: number): R { const p: R = new (F54 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4153(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4154(x: number): R { const p: R = new v54(x); p.c = x + 1; p.b = x + 2; return p; }
function f4155(x: number): R { const p: R = new (G54 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4156(x: number): R { const p: R = new (F54 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4157(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4158(x: number): R { const p: R = new v54(x); p.c = x + 1; p.c = x + 2; return p; }
function f4159(x: number): R { const p: R = new (G54 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4160(x: number): R { const p: R = new (F54 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4161(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4162(x: number): R { const p: R = new v54(x); p.c = x + 1; p.d = x + 2; return p; }
function f4163(x: number): R { const p: R = new (G54 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4164(x: number): R { const p: R = new (F54 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4165(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4166(x: number): R { const p: R = new v54(x); p.d = x + 1; p.a = x + 2; return p; }
function f4167(x: number): R { const p: R = new (G54 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4168(x: number): R { const p: R = new (F54 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4169(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4170(x: number): R { const p: R = new v54(x); p.d = x + 1; p.b = x + 2; return p; }
function f4171(x: number): R { const p: R = new (G54 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4172(x: number): R { const p: R = new (F54 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4173(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4174(x: number): R { const p: R = new v54(x); p.d = x + 1; p.c = x + 2; return p; }
function f4175(x: number): R { const p: R = new (G54 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4176(x: number): R { const p: R = new (F54 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4177(x: number): R { const p: R = new (F54 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4178(x: number): R { const p: R = new v54(x); p.d = x + 1; p.d = x + 2; return p; }
function f4179(x: number): R { const p: R = new (G54 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4180(x: number): R { const p: R = new (F55 as any)(x); p.a = x + 1; return p; }
function f4181(x: number): R { const p: R = new v55(x); p.a = x + 1; return p; }
function f4182(x: number): R { const p: R = new (G55 as any)(x); p.a = x + 1; return p; }
function f4183(x: number): R { const p: R = new (F55 as any)(x); p.b = x + 1; return p; }
function f4184(x: number): R { const p: R = new v55(x); p.b = x + 1; return p; }
function f4185(x: number): R { const p: R = new (G55 as any)(x); p.b = x + 1; return p; }
function f4186(x: number): R { const p: R = new (F55 as any)(x); p.c = x + 1; return p; }
function f4187(x: number): R { const p: R = new v55(x); p.c = x + 1; return p; }
function f4188(x: number): R { const p: R = new (G55 as any)(x); p.c = x + 1; return p; }
function f4189(x: number): R { const p: R = new (F55 as any)(x); p.d = x + 1; return p; }
function f4190(x: number): R { const p: R = new v55(x); p.d = x + 1; return p; }
function f4191(x: number): R { const p: R = new (G55 as any)(x); p.d = x + 1; return p; }
function f4192(x: number): R { const p: R = new (F55 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4193(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4194(x: number): R { const p: R = new v55(x); p.a = x + 1; p.a = x + 2; return p; }
function f4195(x: number): R { const p: R = new (G55 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4196(x: number): R { const p: R = new (F55 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4197(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4198(x: number): R { const p: R = new v55(x); p.a = x + 1; p.b = x + 2; return p; }
function f4199(x: number): R { const p: R = new (G55 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4200(x: number): R { const p: R = new (F55 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4201(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4202(x: number): R { const p: R = new v55(x); p.a = x + 1; p.c = x + 2; return p; }
function f4203(x: number): R { const p: R = new (G55 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4204(x: number): R { const p: R = new (F55 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4205(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4206(x: number): R { const p: R = new v55(x); p.a = x + 1; p.d = x + 2; return p; }
function f4207(x: number): R { const p: R = new (G55 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4208(x: number): R { const p: R = new (F55 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4209(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4210(x: number): R { const p: R = new v55(x); p.b = x + 1; p.a = x + 2; return p; }
function f4211(x: number): R { const p: R = new (G55 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4212(x: number): R { const p: R = new (F55 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4213(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4214(x: number): R { const p: R = new v55(x); p.b = x + 1; p.b = x + 2; return p; }
function f4215(x: number): R { const p: R = new (G55 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4216(x: number): R { const p: R = new (F55 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4217(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4218(x: number): R { const p: R = new v55(x); p.b = x + 1; p.c = x + 2; return p; }
function f4219(x: number): R { const p: R = new (G55 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4220(x: number): R { const p: R = new (F55 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4221(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4222(x: number): R { const p: R = new v55(x); p.b = x + 1; p.d = x + 2; return p; }
function f4223(x: number): R { const p: R = new (G55 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4224(x: number): R { const p: R = new (F55 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4225(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4226(x: number): R { const p: R = new v55(x); p.c = x + 1; p.a = x + 2; return p; }
function f4227(x: number): R { const p: R = new (G55 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4228(x: number): R { const p: R = new (F55 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4229(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4230(x: number): R { const p: R = new v55(x); p.c = x + 1; p.b = x + 2; return p; }
function f4231(x: number): R { const p: R = new (G55 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4232(x: number): R { const p: R = new (F55 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4233(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4234(x: number): R { const p: R = new v55(x); p.c = x + 1; p.c = x + 2; return p; }
function f4235(x: number): R { const p: R = new (G55 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4236(x: number): R { const p: R = new (F55 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4237(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4238(x: number): R { const p: R = new v55(x); p.c = x + 1; p.d = x + 2; return p; }
function f4239(x: number): R { const p: R = new (G55 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4240(x: number): R { const p: R = new (F55 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4241(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4242(x: number): R { const p: R = new v55(x); p.d = x + 1; p.a = x + 2; return p; }
function f4243(x: number): R { const p: R = new (G55 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4244(x: number): R { const p: R = new (F55 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4245(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4246(x: number): R { const p: R = new v55(x); p.d = x + 1; p.b = x + 2; return p; }
function f4247(x: number): R { const p: R = new (G55 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4248(x: number): R { const p: R = new (F55 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4249(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4250(x: number): R { const p: R = new v55(x); p.d = x + 1; p.c = x + 2; return p; }
function f4251(x: number): R { const p: R = new (G55 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4252(x: number): R { const p: R = new (F55 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4253(x: number): R { const p: R = new (F55 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4254(x: number): R { const p: R = new v55(x); p.d = x + 1; p.d = x + 2; return p; }
function f4255(x: number): R { const p: R = new (G55 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4256(x: number): R { const p: R = new (F56 as any)(x); p.a = x + 1; return p; }
function f4257(x: number): R { const p: R = new v56(x); p.a = x + 1; return p; }
function f4258(x: number): R { const p: R = new (G56 as any)(x); p.a = x + 1; return p; }
function f4259(x: number): R { const p: R = new (F56 as any)(x); p.b = x + 1; return p; }
function f4260(x: number): R { const p: R = new v56(x); p.b = x + 1; return p; }
function f4261(x: number): R { const p: R = new (G56 as any)(x); p.b = x + 1; return p; }
function f4262(x: number): R { const p: R = new (F56 as any)(x); p.c = x + 1; return p; }
function f4263(x: number): R { const p: R = new v56(x); p.c = x + 1; return p; }
function f4264(x: number): R { const p: R = new (G56 as any)(x); p.c = x + 1; return p; }
function f4265(x: number): R { const p: R = new (F56 as any)(x); p.d = x + 1; return p; }
function f4266(x: number): R { const p: R = new v56(x); p.d = x + 1; return p; }
function f4267(x: number): R { const p: R = new (G56 as any)(x); p.d = x + 1; return p; }
function f4268(x: number): R { const p: R = new (F56 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4269(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4270(x: number): R { const p: R = new v56(x); p.a = x + 1; p.a = x + 2; return p; }
function f4271(x: number): R { const p: R = new (G56 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4272(x: number): R { const p: R = new (F56 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4273(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4274(x: number): R { const p: R = new v56(x); p.a = x + 1; p.b = x + 2; return p; }
function f4275(x: number): R { const p: R = new (G56 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4276(x: number): R { const p: R = new (F56 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4277(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4278(x: number): R { const p: R = new v56(x); p.a = x + 1; p.c = x + 2; return p; }
function f4279(x: number): R { const p: R = new (G56 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4280(x: number): R { const p: R = new (F56 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4281(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4282(x: number): R { const p: R = new v56(x); p.a = x + 1; p.d = x + 2; return p; }
function f4283(x: number): R { const p: R = new (G56 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4284(x: number): R { const p: R = new (F56 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4285(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4286(x: number): R { const p: R = new v56(x); p.b = x + 1; p.a = x + 2; return p; }
function f4287(x: number): R { const p: R = new (G56 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4288(x: number): R { const p: R = new (F56 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4289(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4290(x: number): R { const p: R = new v56(x); p.b = x + 1; p.b = x + 2; return p; }
function f4291(x: number): R { const p: R = new (G56 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4292(x: number): R { const p: R = new (F56 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4293(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4294(x: number): R { const p: R = new v56(x); p.b = x + 1; p.c = x + 2; return p; }
function f4295(x: number): R { const p: R = new (G56 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4296(x: number): R { const p: R = new (F56 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4297(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4298(x: number): R { const p: R = new v56(x); p.b = x + 1; p.d = x + 2; return p; }
function f4299(x: number): R { const p: R = new (G56 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4300(x: number): R { const p: R = new (F56 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4301(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4302(x: number): R { const p: R = new v56(x); p.c = x + 1; p.a = x + 2; return p; }
function f4303(x: number): R { const p: R = new (G56 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4304(x: number): R { const p: R = new (F56 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4305(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4306(x: number): R { const p: R = new v56(x); p.c = x + 1; p.b = x + 2; return p; }
function f4307(x: number): R { const p: R = new (G56 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4308(x: number): R { const p: R = new (F56 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4309(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4310(x: number): R { const p: R = new v56(x); p.c = x + 1; p.c = x + 2; return p; }
function f4311(x: number): R { const p: R = new (G56 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4312(x: number): R { const p: R = new (F56 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4313(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4314(x: number): R { const p: R = new v56(x); p.c = x + 1; p.d = x + 2; return p; }
function f4315(x: number): R { const p: R = new (G56 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4316(x: number): R { const p: R = new (F56 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4317(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4318(x: number): R { const p: R = new v56(x); p.d = x + 1; p.a = x + 2; return p; }
function f4319(x: number): R { const p: R = new (G56 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4320(x: number): R { const p: R = new (F56 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4321(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4322(x: number): R { const p: R = new v56(x); p.d = x + 1; p.b = x + 2; return p; }
function f4323(x: number): R { const p: R = new (G56 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4324(x: number): R { const p: R = new (F56 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4325(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4326(x: number): R { const p: R = new v56(x); p.d = x + 1; p.c = x + 2; return p; }
function f4327(x: number): R { const p: R = new (G56 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4328(x: number): R { const p: R = new (F56 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4329(x: number): R { const p: R = new (F56 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4330(x: number): R { const p: R = new v56(x); p.d = x + 1; p.d = x + 2; return p; }
function f4331(x: number): R { const p: R = new (G56 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4332(x: number): R { const p: R = new (F57 as any)(x); p.a = x + 1; return p; }
function f4333(x: number): R { const p: R = new v57(x); p.a = x + 1; return p; }
function f4334(x: number): R { const p: R = new (G57 as any)(x); p.a = x + 1; return p; }
function f4335(x: number): R { const p: R = new (F57 as any)(x); p.b = x + 1; return p; }
function f4336(x: number): R { const p: R = new v57(x); p.b = x + 1; return p; }
function f4337(x: number): R { const p: R = new (G57 as any)(x); p.b = x + 1; return p; }
function f4338(x: number): R { const p: R = new (F57 as any)(x); p.c = x + 1; return p; }
function f4339(x: number): R { const p: R = new v57(x); p.c = x + 1; return p; }
function f4340(x: number): R { const p: R = new (G57 as any)(x); p.c = x + 1; return p; }
function f4341(x: number): R { const p: R = new (F57 as any)(x); p.d = x + 1; return p; }
function f4342(x: number): R { const p: R = new v57(x); p.d = x + 1; return p; }
function f4343(x: number): R { const p: R = new (G57 as any)(x); p.d = x + 1; return p; }
function f4344(x: number): R { const p: R = new (F57 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4345(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4346(x: number): R { const p: R = new v57(x); p.a = x + 1; p.a = x + 2; return p; }
function f4347(x: number): R { const p: R = new (G57 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4348(x: number): R { const p: R = new (F57 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4349(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4350(x: number): R { const p: R = new v57(x); p.a = x + 1; p.b = x + 2; return p; }
function f4351(x: number): R { const p: R = new (G57 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4352(x: number): R { const p: R = new (F57 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4353(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4354(x: number): R { const p: R = new v57(x); p.a = x + 1; p.c = x + 2; return p; }
function f4355(x: number): R { const p: R = new (G57 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4356(x: number): R { const p: R = new (F57 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4357(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4358(x: number): R { const p: R = new v57(x); p.a = x + 1; p.d = x + 2; return p; }
function f4359(x: number): R { const p: R = new (G57 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4360(x: number): R { const p: R = new (F57 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4361(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4362(x: number): R { const p: R = new v57(x); p.b = x + 1; p.a = x + 2; return p; }
function f4363(x: number): R { const p: R = new (G57 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4364(x: number): R { const p: R = new (F57 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4365(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4366(x: number): R { const p: R = new v57(x); p.b = x + 1; p.b = x + 2; return p; }
function f4367(x: number): R { const p: R = new (G57 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4368(x: number): R { const p: R = new (F57 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4369(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4370(x: number): R { const p: R = new v57(x); p.b = x + 1; p.c = x + 2; return p; }
function f4371(x: number): R { const p: R = new (G57 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4372(x: number): R { const p: R = new (F57 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4373(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4374(x: number): R { const p: R = new v57(x); p.b = x + 1; p.d = x + 2; return p; }
function f4375(x: number): R { const p: R = new (G57 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4376(x: number): R { const p: R = new (F57 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4377(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4378(x: number): R { const p: R = new v57(x); p.c = x + 1; p.a = x + 2; return p; }
function f4379(x: number): R { const p: R = new (G57 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4380(x: number): R { const p: R = new (F57 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4381(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4382(x: number): R { const p: R = new v57(x); p.c = x + 1; p.b = x + 2; return p; }
function f4383(x: number): R { const p: R = new (G57 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4384(x: number): R { const p: R = new (F57 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4385(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4386(x: number): R { const p: R = new v57(x); p.c = x + 1; p.c = x + 2; return p; }
function f4387(x: number): R { const p: R = new (G57 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4388(x: number): R { const p: R = new (F57 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4389(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4390(x: number): R { const p: R = new v57(x); p.c = x + 1; p.d = x + 2; return p; }
function f4391(x: number): R { const p: R = new (G57 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4392(x: number): R { const p: R = new (F57 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4393(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4394(x: number): R { const p: R = new v57(x); p.d = x + 1; p.a = x + 2; return p; }
function f4395(x: number): R { const p: R = new (G57 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4396(x: number): R { const p: R = new (F57 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4397(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4398(x: number): R { const p: R = new v57(x); p.d = x + 1; p.b = x + 2; return p; }
function f4399(x: number): R { const p: R = new (G57 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4400(x: number): R { const p: R = new (F57 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4401(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4402(x: number): R { const p: R = new v57(x); p.d = x + 1; p.c = x + 2; return p; }
function f4403(x: number): R { const p: R = new (G57 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4404(x: number): R { const p: R = new (F57 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4405(x: number): R { const p: R = new (F57 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4406(x: number): R { const p: R = new v57(x); p.d = x + 1; p.d = x + 2; return p; }
function f4407(x: number): R { const p: R = new (G57 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4408(x: number): R { const p: R = new (F58 as any)(x); p.a = x + 1; return p; }
function f4409(x: number): R { const p: R = new v58(x); p.a = x + 1; return p; }
function f4410(x: number): R { const p: R = new (G58 as any)(x); p.a = x + 1; return p; }
function f4411(x: number): R { const p: R = new (F58 as any)(x); p.b = x + 1; return p; }
function f4412(x: number): R { const p: R = new v58(x); p.b = x + 1; return p; }
function f4413(x: number): R { const p: R = new (G58 as any)(x); p.b = x + 1; return p; }
function f4414(x: number): R { const p: R = new (F58 as any)(x); p.c = x + 1; return p; }
function f4415(x: number): R { const p: R = new v58(x); p.c = x + 1; return p; }
function f4416(x: number): R { const p: R = new (G58 as any)(x); p.c = x + 1; return p; }
function f4417(x: number): R { const p: R = new (F58 as any)(x); p.d = x + 1; return p; }
function f4418(x: number): R { const p: R = new v58(x); p.d = x + 1; return p; }
function f4419(x: number): R { const p: R = new (G58 as any)(x); p.d = x + 1; return p; }
function f4420(x: number): R { const p: R = new (F58 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4421(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4422(x: number): R { const p: R = new v58(x); p.a = x + 1; p.a = x + 2; return p; }
function f4423(x: number): R { const p: R = new (G58 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4424(x: number): R { const p: R = new (F58 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4425(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4426(x: number): R { const p: R = new v58(x); p.a = x + 1; p.b = x + 2; return p; }
function f4427(x: number): R { const p: R = new (G58 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4428(x: number): R { const p: R = new (F58 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4429(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4430(x: number): R { const p: R = new v58(x); p.a = x + 1; p.c = x + 2; return p; }
function f4431(x: number): R { const p: R = new (G58 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4432(x: number): R { const p: R = new (F58 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4433(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4434(x: number): R { const p: R = new v58(x); p.a = x + 1; p.d = x + 2; return p; }
function f4435(x: number): R { const p: R = new (G58 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4436(x: number): R { const p: R = new (F58 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4437(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4438(x: number): R { const p: R = new v58(x); p.b = x + 1; p.a = x + 2; return p; }
function f4439(x: number): R { const p: R = new (G58 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4440(x: number): R { const p: R = new (F58 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4441(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4442(x: number): R { const p: R = new v58(x); p.b = x + 1; p.b = x + 2; return p; }
function f4443(x: number): R { const p: R = new (G58 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4444(x: number): R { const p: R = new (F58 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4445(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4446(x: number): R { const p: R = new v58(x); p.b = x + 1; p.c = x + 2; return p; }
function f4447(x: number): R { const p: R = new (G58 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4448(x: number): R { const p: R = new (F58 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4449(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4450(x: number): R { const p: R = new v58(x); p.b = x + 1; p.d = x + 2; return p; }
function f4451(x: number): R { const p: R = new (G58 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4452(x: number): R { const p: R = new (F58 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4453(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4454(x: number): R { const p: R = new v58(x); p.c = x + 1; p.a = x + 2; return p; }
function f4455(x: number): R { const p: R = new (G58 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4456(x: number): R { const p: R = new (F58 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4457(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4458(x: number): R { const p: R = new v58(x); p.c = x + 1; p.b = x + 2; return p; }
function f4459(x: number): R { const p: R = new (G58 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4460(x: number): R { const p: R = new (F58 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4461(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4462(x: number): R { const p: R = new v58(x); p.c = x + 1; p.c = x + 2; return p; }
function f4463(x: number): R { const p: R = new (G58 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4464(x: number): R { const p: R = new (F58 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4465(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4466(x: number): R { const p: R = new v58(x); p.c = x + 1; p.d = x + 2; return p; }
function f4467(x: number): R { const p: R = new (G58 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4468(x: number): R { const p: R = new (F58 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4469(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4470(x: number): R { const p: R = new v58(x); p.d = x + 1; p.a = x + 2; return p; }
function f4471(x: number): R { const p: R = new (G58 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4472(x: number): R { const p: R = new (F58 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4473(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4474(x: number): R { const p: R = new v58(x); p.d = x + 1; p.b = x + 2; return p; }
function f4475(x: number): R { const p: R = new (G58 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4476(x: number): R { const p: R = new (F58 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4477(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4478(x: number): R { const p: R = new v58(x); p.d = x + 1; p.c = x + 2; return p; }
function f4479(x: number): R { const p: R = new (G58 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4480(x: number): R { const p: R = new (F58 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4481(x: number): R { const p: R = new (F58 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4482(x: number): R { const p: R = new v58(x); p.d = x + 1; p.d = x + 2; return p; }
function f4483(x: number): R { const p: R = new (G58 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4484(x: number): R { const p: R = new (F59 as any)(x); p.a = x + 1; return p; }
function f4485(x: number): R { const p: R = new v59(x); p.a = x + 1; return p; }
function f4486(x: number): R { const p: R = new (G59 as any)(x); p.a = x + 1; return p; }
function f4487(x: number): R { const p: R = new (F59 as any)(x); p.b = x + 1; return p; }
function f4488(x: number): R { const p: R = new v59(x); p.b = x + 1; return p; }
function f4489(x: number): R { const p: R = new (G59 as any)(x); p.b = x + 1; return p; }
function f4490(x: number): R { const p: R = new (F59 as any)(x); p.c = x + 1; return p; }
function f4491(x: number): R { const p: R = new v59(x); p.c = x + 1; return p; }
function f4492(x: number): R { const p: R = new (G59 as any)(x); p.c = x + 1; return p; }
function f4493(x: number): R { const p: R = new (F59 as any)(x); p.d = x + 1; return p; }
function f4494(x: number): R { const p: R = new v59(x); p.d = x + 1; return p; }
function f4495(x: number): R { const p: R = new (G59 as any)(x); p.d = x + 1; return p; }
function f4496(x: number): R { const p: R = new (F59 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4497(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4498(x: number): R { const p: R = new v59(x); p.a = x + 1; p.a = x + 2; return p; }
function f4499(x: number): R { const p: R = new (G59 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4500(x: number): R { const p: R = new (F59 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4501(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4502(x: number): R { const p: R = new v59(x); p.a = x + 1; p.b = x + 2; return p; }
function f4503(x: number): R { const p: R = new (G59 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4504(x: number): R { const p: R = new (F59 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4505(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4506(x: number): R { const p: R = new v59(x); p.a = x + 1; p.c = x + 2; return p; }
function f4507(x: number): R { const p: R = new (G59 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4508(x: number): R { const p: R = new (F59 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4509(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4510(x: number): R { const p: R = new v59(x); p.a = x + 1; p.d = x + 2; return p; }
function f4511(x: number): R { const p: R = new (G59 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4512(x: number): R { const p: R = new (F59 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4513(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4514(x: number): R { const p: R = new v59(x); p.b = x + 1; p.a = x + 2; return p; }
function f4515(x: number): R { const p: R = new (G59 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4516(x: number): R { const p: R = new (F59 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4517(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4518(x: number): R { const p: R = new v59(x); p.b = x + 1; p.b = x + 2; return p; }
function f4519(x: number): R { const p: R = new (G59 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4520(x: number): R { const p: R = new (F59 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4521(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4522(x: number): R { const p: R = new v59(x); p.b = x + 1; p.c = x + 2; return p; }
function f4523(x: number): R { const p: R = new (G59 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4524(x: number): R { const p: R = new (F59 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4525(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4526(x: number): R { const p: R = new v59(x); p.b = x + 1; p.d = x + 2; return p; }
function f4527(x: number): R { const p: R = new (G59 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4528(x: number): R { const p: R = new (F59 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4529(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4530(x: number): R { const p: R = new v59(x); p.c = x + 1; p.a = x + 2; return p; }
function f4531(x: number): R { const p: R = new (G59 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4532(x: number): R { const p: R = new (F59 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4533(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4534(x: number): R { const p: R = new v59(x); p.c = x + 1; p.b = x + 2; return p; }
function f4535(x: number): R { const p: R = new (G59 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4536(x: number): R { const p: R = new (F59 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4537(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4538(x: number): R { const p: R = new v59(x); p.c = x + 1; p.c = x + 2; return p; }
function f4539(x: number): R { const p: R = new (G59 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4540(x: number): R { const p: R = new (F59 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4541(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4542(x: number): R { const p: R = new v59(x); p.c = x + 1; p.d = x + 2; return p; }
function f4543(x: number): R { const p: R = new (G59 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4544(x: number): R { const p: R = new (F59 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4545(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4546(x: number): R { const p: R = new v59(x); p.d = x + 1; p.a = x + 2; return p; }
function f4547(x: number): R { const p: R = new (G59 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4548(x: number): R { const p: R = new (F59 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4549(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4550(x: number): R { const p: R = new v59(x); p.d = x + 1; p.b = x + 2; return p; }
function f4551(x: number): R { const p: R = new (G59 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4552(x: number): R { const p: R = new (F59 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4553(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4554(x: number): R { const p: R = new v59(x); p.d = x + 1; p.c = x + 2; return p; }
function f4555(x: number): R { const p: R = new (G59 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4556(x: number): R { const p: R = new (F59 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4557(x: number): R { const p: R = new (F59 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4558(x: number): R { const p: R = new v59(x); p.d = x + 1; p.d = x + 2; return p; }
function f4559(x: number): R { const p: R = new (G59 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4560(x: number): R { const p: R = new (F60 as any)(x); p.a = x + 1; return p; }
function f4561(x: number): R { const p: R = new v60(x); p.a = x + 1; return p; }
function f4562(x: number): R { const p: R = new (G60 as any)(x); p.a = x + 1; return p; }
function f4563(x: number): R { const p: R = new (F60 as any)(x); p.b = x + 1; return p; }
function f4564(x: number): R { const p: R = new v60(x); p.b = x + 1; return p; }
function f4565(x: number): R { const p: R = new (G60 as any)(x); p.b = x + 1; return p; }
function f4566(x: number): R { const p: R = new (F60 as any)(x); p.c = x + 1; return p; }
function f4567(x: number): R { const p: R = new v60(x); p.c = x + 1; return p; }
function f4568(x: number): R { const p: R = new (G60 as any)(x); p.c = x + 1; return p; }
function f4569(x: number): R { const p: R = new (F60 as any)(x); p.d = x + 1; return p; }
function f4570(x: number): R { const p: R = new v60(x); p.d = x + 1; return p; }
function f4571(x: number): R { const p: R = new (G60 as any)(x); p.d = x + 1; return p; }
function f4572(x: number): R { const p: R = new (F60 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4573(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4574(x: number): R { const p: R = new v60(x); p.a = x + 1; p.a = x + 2; return p; }
function f4575(x: number): R { const p: R = new (G60 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4576(x: number): R { const p: R = new (F60 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4577(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4578(x: number): R { const p: R = new v60(x); p.a = x + 1; p.b = x + 2; return p; }
function f4579(x: number): R { const p: R = new (G60 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4580(x: number): R { const p: R = new (F60 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4581(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4582(x: number): R { const p: R = new v60(x); p.a = x + 1; p.c = x + 2; return p; }
function f4583(x: number): R { const p: R = new (G60 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4584(x: number): R { const p: R = new (F60 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4585(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4586(x: number): R { const p: R = new v60(x); p.a = x + 1; p.d = x + 2; return p; }
function f4587(x: number): R { const p: R = new (G60 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4588(x: number): R { const p: R = new (F60 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4589(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4590(x: number): R { const p: R = new v60(x); p.b = x + 1; p.a = x + 2; return p; }
function f4591(x: number): R { const p: R = new (G60 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4592(x: number): R { const p: R = new (F60 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4593(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4594(x: number): R { const p: R = new v60(x); p.b = x + 1; p.b = x + 2; return p; }
function f4595(x: number): R { const p: R = new (G60 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4596(x: number): R { const p: R = new (F60 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4597(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4598(x: number): R { const p: R = new v60(x); p.b = x + 1; p.c = x + 2; return p; }
function f4599(x: number): R { const p: R = new (G60 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4600(x: number): R { const p: R = new (F60 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4601(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4602(x: number): R { const p: R = new v60(x); p.b = x + 1; p.d = x + 2; return p; }
function f4603(x: number): R { const p: R = new (G60 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4604(x: number): R { const p: R = new (F60 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4605(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4606(x: number): R { const p: R = new v60(x); p.c = x + 1; p.a = x + 2; return p; }
function f4607(x: number): R { const p: R = new (G60 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4608(x: number): R { const p: R = new (F60 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4609(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4610(x: number): R { const p: R = new v60(x); p.c = x + 1; p.b = x + 2; return p; }
function f4611(x: number): R { const p: R = new (G60 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4612(x: number): R { const p: R = new (F60 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4613(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4614(x: number): R { const p: R = new v60(x); p.c = x + 1; p.c = x + 2; return p; }
function f4615(x: number): R { const p: R = new (G60 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4616(x: number): R { const p: R = new (F60 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4617(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4618(x: number): R { const p: R = new v60(x); p.c = x + 1; p.d = x + 2; return p; }
function f4619(x: number): R { const p: R = new (G60 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4620(x: number): R { const p: R = new (F60 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4621(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4622(x: number): R { const p: R = new v60(x); p.d = x + 1; p.a = x + 2; return p; }
function f4623(x: number): R { const p: R = new (G60 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4624(x: number): R { const p: R = new (F60 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4625(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4626(x: number): R { const p: R = new v60(x); p.d = x + 1; p.b = x + 2; return p; }
function f4627(x: number): R { const p: R = new (G60 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4628(x: number): R { const p: R = new (F60 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4629(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4630(x: number): R { const p: R = new v60(x); p.d = x + 1; p.c = x + 2; return p; }
function f4631(x: number): R { const p: R = new (G60 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4632(x: number): R { const p: R = new (F60 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4633(x: number): R { const p: R = new (F60 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4634(x: number): R { const p: R = new v60(x); p.d = x + 1; p.d = x + 2; return p; }
function f4635(x: number): R { const p: R = new (G60 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4636(x: number): R { const p: R = new (F61 as any)(x); p.a = x + 1; return p; }
function f4637(x: number): R { const p: R = new v61(x); p.a = x + 1; return p; }
function f4638(x: number): R { const p: R = new (G61 as any)(x); p.a = x + 1; return p; }
function f4639(x: number): R { const p: R = new (F61 as any)(x); p.b = x + 1; return p; }
function f4640(x: number): R { const p: R = new v61(x); p.b = x + 1; return p; }
function f4641(x: number): R { const p: R = new (G61 as any)(x); p.b = x + 1; return p; }
function f4642(x: number): R { const p: R = new (F61 as any)(x); p.c = x + 1; return p; }
function f4643(x: number): R { const p: R = new v61(x); p.c = x + 1; return p; }
function f4644(x: number): R { const p: R = new (G61 as any)(x); p.c = x + 1; return p; }
function f4645(x: number): R { const p: R = new (F61 as any)(x); p.d = x + 1; return p; }
function f4646(x: number): R { const p: R = new v61(x); p.d = x + 1; return p; }
function f4647(x: number): R { const p: R = new (G61 as any)(x); p.d = x + 1; return p; }
function f4648(x: number): R { const p: R = new (F61 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4649(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4650(x: number): R { const p: R = new v61(x); p.a = x + 1; p.a = x + 2; return p; }
function f4651(x: number): R { const p: R = new (G61 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4652(x: number): R { const p: R = new (F61 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4653(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4654(x: number): R { const p: R = new v61(x); p.a = x + 1; p.b = x + 2; return p; }
function f4655(x: number): R { const p: R = new (G61 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4656(x: number): R { const p: R = new (F61 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4657(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4658(x: number): R { const p: R = new v61(x); p.a = x + 1; p.c = x + 2; return p; }
function f4659(x: number): R { const p: R = new (G61 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4660(x: number): R { const p: R = new (F61 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4661(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4662(x: number): R { const p: R = new v61(x); p.a = x + 1; p.d = x + 2; return p; }
function f4663(x: number): R { const p: R = new (G61 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4664(x: number): R { const p: R = new (F61 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4665(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4666(x: number): R { const p: R = new v61(x); p.b = x + 1; p.a = x + 2; return p; }
function f4667(x: number): R { const p: R = new (G61 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4668(x: number): R { const p: R = new (F61 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4669(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4670(x: number): R { const p: R = new v61(x); p.b = x + 1; p.b = x + 2; return p; }
function f4671(x: number): R { const p: R = new (G61 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4672(x: number): R { const p: R = new (F61 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4673(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4674(x: number): R { const p: R = new v61(x); p.b = x + 1; p.c = x + 2; return p; }
function f4675(x: number): R { const p: R = new (G61 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4676(x: number): R { const p: R = new (F61 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4677(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4678(x: number): R { const p: R = new v61(x); p.b = x + 1; p.d = x + 2; return p; }
function f4679(x: number): R { const p: R = new (G61 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4680(x: number): R { const p: R = new (F61 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4681(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4682(x: number): R { const p: R = new v61(x); p.c = x + 1; p.a = x + 2; return p; }
function f4683(x: number): R { const p: R = new (G61 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4684(x: number): R { const p: R = new (F61 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4685(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4686(x: number): R { const p: R = new v61(x); p.c = x + 1; p.b = x + 2; return p; }
function f4687(x: number): R { const p: R = new (G61 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4688(x: number): R { const p: R = new (F61 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4689(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4690(x: number): R { const p: R = new v61(x); p.c = x + 1; p.c = x + 2; return p; }
function f4691(x: number): R { const p: R = new (G61 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4692(x: number): R { const p: R = new (F61 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4693(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4694(x: number): R { const p: R = new v61(x); p.c = x + 1; p.d = x + 2; return p; }
function f4695(x: number): R { const p: R = new (G61 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4696(x: number): R { const p: R = new (F61 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4697(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4698(x: number): R { const p: R = new v61(x); p.d = x + 1; p.a = x + 2; return p; }
function f4699(x: number): R { const p: R = new (G61 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4700(x: number): R { const p: R = new (F61 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4701(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4702(x: number): R { const p: R = new v61(x); p.d = x + 1; p.b = x + 2; return p; }
function f4703(x: number): R { const p: R = new (G61 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4704(x: number): R { const p: R = new (F61 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4705(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4706(x: number): R { const p: R = new v61(x); p.d = x + 1; p.c = x + 2; return p; }
function f4707(x: number): R { const p: R = new (G61 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4708(x: number): R { const p: R = new (F61 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4709(x: number): R { const p: R = new (F61 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4710(x: number): R { const p: R = new v61(x); p.d = x + 1; p.d = x + 2; return p; }
function f4711(x: number): R { const p: R = new (G61 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4712(x: number): R { const p: R = new (F62 as any)(x); p.a = x + 1; return p; }
function f4713(x: number): R { const p: R = new v62(x); p.a = x + 1; return p; }
function f4714(x: number): R { const p: R = new (G62 as any)(x); p.a = x + 1; return p; }
function f4715(x: number): R { const p: R = new (F62 as any)(x); p.b = x + 1; return p; }
function f4716(x: number): R { const p: R = new v62(x); p.b = x + 1; return p; }
function f4717(x: number): R { const p: R = new (G62 as any)(x); p.b = x + 1; return p; }
function f4718(x: number): R { const p: R = new (F62 as any)(x); p.c = x + 1; return p; }
function f4719(x: number): R { const p: R = new v62(x); p.c = x + 1; return p; }
function f4720(x: number): R { const p: R = new (G62 as any)(x); p.c = x + 1; return p; }
function f4721(x: number): R { const p: R = new (F62 as any)(x); p.d = x + 1; return p; }
function f4722(x: number): R { const p: R = new v62(x); p.d = x + 1; return p; }
function f4723(x: number): R { const p: R = new (G62 as any)(x); p.d = x + 1; return p; }
function f4724(x: number): R { const p: R = new (F62 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4725(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4726(x: number): R { const p: R = new v62(x); p.a = x + 1; p.a = x + 2; return p; }
function f4727(x: number): R { const p: R = new (G62 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4728(x: number): R { const p: R = new (F62 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4729(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4730(x: number): R { const p: R = new v62(x); p.a = x + 1; p.b = x + 2; return p; }
function f4731(x: number): R { const p: R = new (G62 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4732(x: number): R { const p: R = new (F62 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4733(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4734(x: number): R { const p: R = new v62(x); p.a = x + 1; p.c = x + 2; return p; }
function f4735(x: number): R { const p: R = new (G62 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4736(x: number): R { const p: R = new (F62 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4737(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4738(x: number): R { const p: R = new v62(x); p.a = x + 1; p.d = x + 2; return p; }
function f4739(x: number): R { const p: R = new (G62 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4740(x: number): R { const p: R = new (F62 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4741(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4742(x: number): R { const p: R = new v62(x); p.b = x + 1; p.a = x + 2; return p; }
function f4743(x: number): R { const p: R = new (G62 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4744(x: number): R { const p: R = new (F62 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4745(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4746(x: number): R { const p: R = new v62(x); p.b = x + 1; p.b = x + 2; return p; }
function f4747(x: number): R { const p: R = new (G62 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4748(x: number): R { const p: R = new (F62 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4749(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4750(x: number): R { const p: R = new v62(x); p.b = x + 1; p.c = x + 2; return p; }
function f4751(x: number): R { const p: R = new (G62 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4752(x: number): R { const p: R = new (F62 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4753(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4754(x: number): R { const p: R = new v62(x); p.b = x + 1; p.d = x + 2; return p; }
function f4755(x: number): R { const p: R = new (G62 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4756(x: number): R { const p: R = new (F62 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4757(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4758(x: number): R { const p: R = new v62(x); p.c = x + 1; p.a = x + 2; return p; }
function f4759(x: number): R { const p: R = new (G62 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4760(x: number): R { const p: R = new (F62 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4761(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4762(x: number): R { const p: R = new v62(x); p.c = x + 1; p.b = x + 2; return p; }
function f4763(x: number): R { const p: R = new (G62 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4764(x: number): R { const p: R = new (F62 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4765(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4766(x: number): R { const p: R = new v62(x); p.c = x + 1; p.c = x + 2; return p; }
function f4767(x: number): R { const p: R = new (G62 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4768(x: number): R { const p: R = new (F62 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4769(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4770(x: number): R { const p: R = new v62(x); p.c = x + 1; p.d = x + 2; return p; }
function f4771(x: number): R { const p: R = new (G62 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4772(x: number): R { const p: R = new (F62 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4773(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4774(x: number): R { const p: R = new v62(x); p.d = x + 1; p.a = x + 2; return p; }
function f4775(x: number): R { const p: R = new (G62 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4776(x: number): R { const p: R = new (F62 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4777(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4778(x: number): R { const p: R = new v62(x); p.d = x + 1; p.b = x + 2; return p; }
function f4779(x: number): R { const p: R = new (G62 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4780(x: number): R { const p: R = new (F62 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4781(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4782(x: number): R { const p: R = new v62(x); p.d = x + 1; p.c = x + 2; return p; }
function f4783(x: number): R { const p: R = new (G62 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4784(x: number): R { const p: R = new (F62 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4785(x: number): R { const p: R = new (F62 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4786(x: number): R { const p: R = new v62(x); p.d = x + 1; p.d = x + 2; return p; }
function f4787(x: number): R { const p: R = new (G62 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4788(x: number): R { const p: R = new (F63 as any)(x); p.a = x + 1; return p; }
function f4789(x: number): R { const p: R = new v63(x); p.a = x + 1; return p; }
function f4790(x: number): R { const p: R = new (G63 as any)(x); p.a = x + 1; return p; }
function f4791(x: number): R { const p: R = new (F63 as any)(x); p.b = x + 1; return p; }
function f4792(x: number): R { const p: R = new v63(x); p.b = x + 1; return p; }
function f4793(x: number): R { const p: R = new (G63 as any)(x); p.b = x + 1; return p; }
function f4794(x: number): R { const p: R = new (F63 as any)(x); p.c = x + 1; return p; }
function f4795(x: number): R { const p: R = new v63(x); p.c = x + 1; return p; }
function f4796(x: number): R { const p: R = new (G63 as any)(x); p.c = x + 1; return p; }
function f4797(x: number): R { const p: R = new (F63 as any)(x); p.d = x + 1; return p; }
function f4798(x: number): R { const p: R = new v63(x); p.d = x + 1; return p; }
function f4799(x: number): R { const p: R = new (G63 as any)(x); p.d = x + 1; return p; }
function f4800(x: number): R { const p: R = new (F63 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4801(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4802(x: number): R { const p: R = new v63(x); p.a = x + 1; p.a = x + 2; return p; }
function f4803(x: number): R { const p: R = new (G63 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4804(x: number): R { const p: R = new (F63 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4805(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4806(x: number): R { const p: R = new v63(x); p.a = x + 1; p.b = x + 2; return p; }
function f4807(x: number): R { const p: R = new (G63 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4808(x: number): R { const p: R = new (F63 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4809(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4810(x: number): R { const p: R = new v63(x); p.a = x + 1; p.c = x + 2; return p; }
function f4811(x: number): R { const p: R = new (G63 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4812(x: number): R { const p: R = new (F63 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4813(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4814(x: number): R { const p: R = new v63(x); p.a = x + 1; p.d = x + 2; return p; }
function f4815(x: number): R { const p: R = new (G63 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4816(x: number): R { const p: R = new (F63 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4817(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4818(x: number): R { const p: R = new v63(x); p.b = x + 1; p.a = x + 2; return p; }
function f4819(x: number): R { const p: R = new (G63 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4820(x: number): R { const p: R = new (F63 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4821(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4822(x: number): R { const p: R = new v63(x); p.b = x + 1; p.b = x + 2; return p; }
function f4823(x: number): R { const p: R = new (G63 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4824(x: number): R { const p: R = new (F63 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4825(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4826(x: number): R { const p: R = new v63(x); p.b = x + 1; p.c = x + 2; return p; }
function f4827(x: number): R { const p: R = new (G63 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4828(x: number): R { const p: R = new (F63 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4829(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4830(x: number): R { const p: R = new v63(x); p.b = x + 1; p.d = x + 2; return p; }
function f4831(x: number): R { const p: R = new (G63 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4832(x: number): R { const p: R = new (F63 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4833(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4834(x: number): R { const p: R = new v63(x); p.c = x + 1; p.a = x + 2; return p; }
function f4835(x: number): R { const p: R = new (G63 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4836(x: number): R { const p: R = new (F63 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4837(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4838(x: number): R { const p: R = new v63(x); p.c = x + 1; p.b = x + 2; return p; }
function f4839(x: number): R { const p: R = new (G63 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4840(x: number): R { const p: R = new (F63 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4841(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4842(x: number): R { const p: R = new v63(x); p.c = x + 1; p.c = x + 2; return p; }
function f4843(x: number): R { const p: R = new (G63 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4844(x: number): R { const p: R = new (F63 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4845(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4846(x: number): R { const p: R = new v63(x); p.c = x + 1; p.d = x + 2; return p; }
function f4847(x: number): R { const p: R = new (G63 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4848(x: number): R { const p: R = new (F63 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4849(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4850(x: number): R { const p: R = new v63(x); p.d = x + 1; p.a = x + 2; return p; }
function f4851(x: number): R { const p: R = new (G63 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4852(x: number): R { const p: R = new (F63 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4853(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4854(x: number): R { const p: R = new v63(x); p.d = x + 1; p.b = x + 2; return p; }
function f4855(x: number): R { const p: R = new (G63 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4856(x: number): R { const p: R = new (F63 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4857(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4858(x: number): R { const p: R = new v63(x); p.d = x + 1; p.c = x + 2; return p; }
function f4859(x: number): R { const p: R = new (G63 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4860(x: number): R { const p: R = new (F63 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4861(x: number): R { const p: R = new (F63 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4862(x: number): R { const p: R = new v63(x); p.d = x + 1; p.d = x + 2; return p; }
function f4863(x: number): R { const p: R = new (G63 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4864(x: number): R { const p: R = new (F64 as any)(x); p.a = x + 1; return p; }
function f4865(x: number): R { const p: R = new v64(x); p.a = x + 1; return p; }
function f4866(x: number): R { const p: R = new (G64 as any)(x); p.a = x + 1; return p; }
function f4867(x: number): R { const p: R = new (F64 as any)(x); p.b = x + 1; return p; }
function f4868(x: number): R { const p: R = new v64(x); p.b = x + 1; return p; }
function f4869(x: number): R { const p: R = new (G64 as any)(x); p.b = x + 1; return p; }
function f4870(x: number): R { const p: R = new (F64 as any)(x); p.c = x + 1; return p; }
function f4871(x: number): R { const p: R = new v64(x); p.c = x + 1; return p; }
function f4872(x: number): R { const p: R = new (G64 as any)(x); p.c = x + 1; return p; }
function f4873(x: number): R { const p: R = new (F64 as any)(x); p.d = x + 1; return p; }
function f4874(x: number): R { const p: R = new v64(x); p.d = x + 1; return p; }
function f4875(x: number): R { const p: R = new (G64 as any)(x); p.d = x + 1; return p; }
function f4876(x: number): R { const p: R = new (F64 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4877(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.a = x + 1; p.a = x + 2; return p; }
function f4878(x: number): R { const p: R = new v64(x); p.a = x + 1; p.a = x + 2; return p; }
function f4879(x: number): R { const p: R = new (G64 as any)(x); p.a = x + 1; p.a = x + 2; return p; }
function f4880(x: number): R { const p: R = new (F64 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4881(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.a = x + 1; p.b = x + 2; return p; }
function f4882(x: number): R { const p: R = new v64(x); p.a = x + 1; p.b = x + 2; return p; }
function f4883(x: number): R { const p: R = new (G64 as any)(x); p.a = x + 1; p.b = x + 2; return p; }
function f4884(x: number): R { const p: R = new (F64 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4885(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.a = x + 1; p.c = x + 2; return p; }
function f4886(x: number): R { const p: R = new v64(x); p.a = x + 1; p.c = x + 2; return p; }
function f4887(x: number): R { const p: R = new (G64 as any)(x); p.a = x + 1; p.c = x + 2; return p; }
function f4888(x: number): R { const p: R = new (F64 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4889(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.a = x + 1; p.d = x + 2; return p; }
function f4890(x: number): R { const p: R = new v64(x); p.a = x + 1; p.d = x + 2; return p; }
function f4891(x: number): R { const p: R = new (G64 as any)(x); p.a = x + 1; p.d = x + 2; return p; }
function f4892(x: number): R { const p: R = new (F64 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4893(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.b = x + 1; p.a = x + 2; return p; }
function f4894(x: number): R { const p: R = new v64(x); p.b = x + 1; p.a = x + 2; return p; }
function f4895(x: number): R { const p: R = new (G64 as any)(x); p.b = x + 1; p.a = x + 2; return p; }
function f4896(x: number): R { const p: R = new (F64 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4897(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.b = x + 1; p.b = x + 2; return p; }
function f4898(x: number): R { const p: R = new v64(x); p.b = x + 1; p.b = x + 2; return p; }
function f4899(x: number): R { const p: R = new (G64 as any)(x); p.b = x + 1; p.b = x + 2; return p; }
function f4900(x: number): R { const p: R = new (F64 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4901(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.b = x + 1; p.c = x + 2; return p; }
function f4902(x: number): R { const p: R = new v64(x); p.b = x + 1; p.c = x + 2; return p; }
function f4903(x: number): R { const p: R = new (G64 as any)(x); p.b = x + 1; p.c = x + 2; return p; }
function f4904(x: number): R { const p: R = new (F64 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4905(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.b = x + 1; p.d = x + 2; return p; }
function f4906(x: number): R { const p: R = new v64(x); p.b = x + 1; p.d = x + 2; return p; }
function f4907(x: number): R { const p: R = new (G64 as any)(x); p.b = x + 1; p.d = x + 2; return p; }
function f4908(x: number): R { const p: R = new (F64 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4909(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.c = x + 1; p.a = x + 2; return p; }
function f4910(x: number): R { const p: R = new v64(x); p.c = x + 1; p.a = x + 2; return p; }
function f4911(x: number): R { const p: R = new (G64 as any)(x); p.c = x + 1; p.a = x + 2; return p; }
function f4912(x: number): R { const p: R = new (F64 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4913(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.c = x + 1; p.b = x + 2; return p; }
function f4914(x: number): R { const p: R = new v64(x); p.c = x + 1; p.b = x + 2; return p; }
function f4915(x: number): R { const p: R = new (G64 as any)(x); p.c = x + 1; p.b = x + 2; return p; }
function f4916(x: number): R { const p: R = new (F64 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4917(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.c = x + 1; p.c = x + 2; return p; }
function f4918(x: number): R { const p: R = new v64(x); p.c = x + 1; p.c = x + 2; return p; }
function f4919(x: number): R { const p: R = new (G64 as any)(x); p.c = x + 1; p.c = x + 2; return p; }
function f4920(x: number): R { const p: R = new (F64 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4921(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.c = x + 1; p.d = x + 2; return p; }
function f4922(x: number): R { const p: R = new v64(x); p.c = x + 1; p.d = x + 2; return p; }
function f4923(x: number): R { const p: R = new (G64 as any)(x); p.c = x + 1; p.d = x + 2; return p; }
function f4924(x: number): R { const p: R = new (F64 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4925(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.d = x + 1; p.a = x + 2; return p; }
function f4926(x: number): R { const p: R = new v64(x); p.d = x + 1; p.a = x + 2; return p; }
function f4927(x: number): R { const p: R = new (G64 as any)(x); p.d = x + 1; p.a = x + 2; return p; }
function f4928(x: number): R { const p: R = new (F64 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4929(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.d = x + 1; p.b = x + 2; return p; }
function f4930(x: number): R { const p: R = new v64(x); p.d = x + 1; p.b = x + 2; return p; }
function f4931(x: number): R { const p: R = new (G64 as any)(x); p.d = x + 1; p.b = x + 2; return p; }
function f4932(x: number): R { const p: R = new (F64 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4933(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.d = x + 1; p.c = x + 2; return p; }
function f4934(x: number): R { const p: R = new v64(x); p.d = x + 1; p.c = x + 2; return p; }
function f4935(x: number): R { const p: R = new (G64 as any)(x); p.d = x + 1; p.c = x + 2; return p; }
function f4936(x: number): R { const p: R = new (F64 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
function f4937(x: number): R { const p: R = new (F64 as any)(x); if (x & 1) p.d = x + 1; p.d = x + 2; return p; }
function f4938(x: number): R { const p: R = new v64(x); p.d = x + 1; p.d = x + 2; return p; }
function f4939(x: number): R { const p: R = new (G64 as any)(x); p.d = x + 1; p.d = x + 2; return p; }
v0 = F0; v1 = F1; v2 = F2; v3 = F3; v4 = F4; v5 = F5; v6 = F6; v7 = F7; v8 = F8; v9 = F9; v10 = F10; v11 = F11; v12 = F12; v13 = F13; v14 = F14; v15 = F15; v16 = F16; v17 = F17; v18 = F18; v19 = F19; v20 = F20; v21 = F21; v22 = F22; v23 = F23; v24 = F24; v25 = F25; v26 = F26; v27 = F27; v28 = F28; v29 = F29; v30 = F30; v31 = F31; v32 = F32; v33 = F33; v34 = F34; v35 = F35; v36 = F36; v37 = F37; v38 = F38; v39 = F39; v40 = F40; v41 = F41; v42 = F42; v43 = F43; v44 = F44; v45 = F45; v46 = F46; v47 = F47; v48 = F48; v49 = F49; v50 = F50; v51 = F51; v52 = F52; v53 = F53; v54 = F54; v55 = F55; v56 = F56; v57 = F57; v58 = F58; v59 = F59; v60 = F60; v61 = F61; v62 = F62; v63 = F63; v64 = F64;
const all = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35, f36, f37, f38, f39, f40, f41, f42, f43, f44, f45, f46, f47, f48, f49, f50, f51, f52, f53, f54, f55, f56, f57, f58, f59, f60, f61, f62, f63, f64, f65, f66, f67, f68, f69, f70, f71, f72, f73, f74, f75, f76, f77, f78, f79, f80, f81, f82, f83, f84, f85, f86, f87, f88, f89, f90, f91, f92, f93, f94, f95, f96, f97, f98, f99, f100, f101, f102, f103, f104, f105, f106, f107, f108, f109, f110, f111, f112, f113, f114, f115, f116, f117, f118, f119, f120, f121, f122, f123, f124, f125, f126, f127, f128, f129, f130, f131, f132, f133, f134, f135, f136, f137, f138, f139, f140, f141, f142, f143, f144, f145, f146, f147, f148, f149, f150, f151, f152, f153, f154, f155, f156, f157, f158, f159, f160, f161, f162, f163, f164, f165, f166, f167, f168, f169, f170, f171, f172, f173, f174, f175, f176, f177, f178, f179, f180, f181, f182, f183, f184, f185, f186, f187, f188, f189, f190, f191, f192, f193, f194, f195, f196, f197, f198, f199, f200, f201, f202, f203, f204, f205, f206, f207, f208, f209, f210, f211, f212, f213, f214, f215, f216, f217, f218, f219, f220, f221, f222, f223, f224, f225, f226, f227, f228, f229, f230, f231, f232, f233, f234, f235, f236, f237, f238, f239, f240, f241, f242, f243, f244, f245, f246, f247, f248, f249, f250, f251, f252, f253, f254, f255, f256, f257, f258, f259, f260, f261, f262, f263, f264, f265, f266, f267, f268, f269, f270, f271, f272, f273, f274, f275, f276, f277, f278, f279, f280, f281, f282, f283, f284, f285, f286, f287, f288, f289, f290, f291, f292, f293, f294, f295, f296, f297, f298, f299, f300, f301, f302, f303, f304, f305, f306, f307, f308, f309, f310, f311, f312, f313, f314, f315, f316, f317, f318, f319, f320, f321, f322, f323, f324, f325, f326, f327, f328, f329, f330, f331, f332, f333, f334, f335, f336, f337, f338, f339, f340, f341, f342, f343, f344, f345, f346, f347, f348, f349, f350, f351, f352, f353, f354, f355, f356, f357, f358, f359, f360, f361, f362, f363, f364, f365, f366, f367, f368, f369, f370, f371, f372, f373, f374, f375, f376, f377, f378, f379, f380, f381, f382, f383, f384, f385, f386, f387, f388, f389, f390, f391, f392, f393, f394, f395, f396, f397, f398, f399, f400, f401, f402, f403, f404, f405, f406, f407, f408, f409, f410, f411, f412, f413, f414, f415, f416, f417, f418, f419, f420, f421, f422, f423, f424, f425, f426, f427, f428, f429, f430, f431, f432, f433, f434, f435, f436, f437, f438, f439, f440, f441, f442, f443, f444, f445, f446, f447, f448, f449, f450, f451, f452, f453, f454, f455, f456, f457, f458, f459, f460, f461, f462, f463, f464, f465, f466, f467, f468, f469, f470, f471, f472, f473, f474, f475, f476, f477, f478, f479, f480, f481, f482, f483, f484, f485, f486, f487, f488, f489, f490, f491, f492, f493, f494, f495, f496, f497, f498, f499, f500, f501, f502, f503, f504, f505, f506, f507, f508, f509, f510, f511, f512, f513, f514, f515, f516, f517, f518, f519, f520, f521, f522, f523, f524, f525, f526, f527, f528, f529, f530, f531, f532, f533, f534, f535, f536, f537, f538, f539, f540, f541, f542, f543, f544, f545, f546, f547, f548, f549, f550, f551, f552, f553, f554, f555, f556, f557, f558, f559, f560, f561, f562, f563, f564, f565, f566, f567, f568, f569, f570, f571, f572, f573, f574, f575, f576, f577, f578, f579, f580, f581, f582, f583, f584, f585, f586, f587, f588, f589, f590, f591, f592, f593, f594, f595, f596, f597, f598, f599, f600, f601, f602, f603, f604, f605, f606, f607, f608, f609, f610, f611, f612, f613, f614, f615, f616, f617, f618, f619, f620, f621, f622, f623, f624, f625, f626, f627, f628, f629, f630, f631, f632, f633, f634, f635, f636, f637, f638, f639, f640, f641, f642, f643, f644, f645, f646, f647, f648, f649, f650, f651, f652, f653, f654, f655, f656, f657, f658, f659, f660, f661, f662, f663, f664, f665, f666, f667, f668, f669, f670, f671, f672, f673, f674, f675, f676, f677, f678, f679, f680, f681, f682, f683, f684, f685, f686, f687, f688, f689, f690, f691, f692, f693, f694, f695, f696, f697, f698, f699, f700, f701, f702, f703, f704, f705, f706, f707, f708, f709, f710, f711, f712, f713, f714, f715, f716, f717, f718, f719, f720, f721, f722, f723, f724, f725, f726, f727, f728, f729, f730, f731, f732, f733, f734, f735, f736, f737, f738, f739, f740, f741, f742, f743, f744, f745, f746, f747, f748, f749, f750, f751, f752, f753, f754, f755, f756, f757, f758, f759, f760, f761, f762, f763, f764, f765, f766, f767, f768, f769, f770, f771, f772, f773, f774, f775, f776, f777, f778, f779, f780, f781, f782, f783, f784, f785, f786, f787, f788, f789, f790, f791, f792, f793, f794, f795, f796, f797, f798, f799, f800, f801, f802, f803, f804, f805, f806, f807, f808, f809, f810, f811, f812, f813, f814, f815, f816, f817, f818, f819, f820, f821, f822, f823, f824, f825, f826, f827, f828, f829, f830, f831, f832, f833, f834, f835, f836, f837, f838, f839, f840, f841, f842, f843, f844, f845, f846, f847, f848, f849, f850, f851, f852, f853, f854, f855, f856, f857, f858, f859, f860, f861, f862, f863, f864, f865, f866, f867, f868, f869, f870, f871, f872, f873, f874, f875, f876, f877, f878, f879, f880, f881, f882, f883, f884, f885, f886, f887, f888, f889, f890, f891, f892, f893, f894, f895, f896, f897, f898, f899, f900, f901, f902, f903, f904, f905, f906, f907, f908, f909, f910, f911, f912, f913, f914, f915, f916, f917, f918, f919, f920, f921, f922, f923, f924, f925, f926, f927, f928, f929, f930, f931, f932, f933, f934, f935, f936, f937, f938, f939, f940, f941, f942, f943, f944, f945, f946, f947, f948, f949, f950, f951, f952, f953, f954, f955, f956, f957, f958, f959, f960, f961, f962, f963, f964, f965, f966, f967, f968, f969, f970, f971, f972, f973, f974, f975, f976, f977, f978, f979, f980, f981, f982, f983, f984, f985, f986, f987, f988, f989, f990, f991, f992, f993, f994, f995, f996, f997, f998, f999, f1000, f1001, f1002, f1003, f1004, f1005, f1006, f1007, f1008, f1009, f1010, f1011, f1012, f1013, f1014, f1015, f1016, f1017, f1018, f1019, f1020, f1021, f1022, f1023, f1024, f1025, f1026, f1027, f1028, f1029, f1030, f1031, f1032, f1033, f1034, f1035, f1036, f1037, f1038, f1039, f1040, f1041, f1042, f1043, f1044, f1045, f1046, f1047, f1048, f1049, f1050, f1051, f1052, f1053, f1054, f1055, f1056, f1057, f1058, f1059, f1060, f1061, f1062, f1063, f1064, f1065, f1066, f1067, f1068, f1069, f1070, f1071, f1072, f1073, f1074, f1075, f1076, f1077, f1078, f1079, f1080, f1081, f1082, f1083, f1084, f1085, f1086, f1087, f1088, f1089, f1090, f1091, f1092, f1093, f1094, f1095, f1096, f1097, f1098, f1099, f1100, f1101, f1102, f1103, f1104, f1105, f1106, f1107, f1108, f1109, f1110, f1111, f1112, f1113, f1114, f1115, f1116, f1117, f1118, f1119, f1120, f1121, f1122, f1123, f1124, f1125, f1126, f1127, f1128, f1129, f1130, f1131, f1132, f1133, f1134, f1135, f1136, f1137, f1138, f1139, f1140, f1141, f1142, f1143, f1144, f1145, f1146, f1147, f1148, f1149, f1150, f1151, f1152, f1153, f1154, f1155, f1156, f1157, f1158, f1159, f1160, f1161, f1162, f1163, f1164, f1165, f1166, f1167, f1168, f1169, f1170, f1171, f1172, f1173, f1174, f1175, f1176, f1177, f1178, f1179, f1180, f1181, f1182, f1183, f1184, f1185, f1186, f1187, f1188, f1189, f1190, f1191, f1192, f1193, f1194, f1195, f1196, f1197, f1198, f1199, f1200, f1201, f1202, f1203, f1204, f1205, f1206, f1207, f1208, f1209, f1210, f1211, f1212, f1213, f1214, f1215, f1216, f1217, f1218, f1219, f1220, f1221, f1222, f1223, f1224, f1225, f1226, f1227, f1228, f1229, f1230, f1231, f1232, f1233, f1234, f1235, f1236, f1237, f1238, f1239, f1240, f1241, f1242, f1243, f1244, f1245, f1246, f1247, f1248, f1249, f1250, f1251, f1252, f1253, f1254, f1255, f1256, f1257, f1258, f1259, f1260, f1261, f1262, f1263, f1264, f1265, f1266, f1267, f1268, f1269, f1270, f1271, f1272, f1273, f1274, f1275, f1276, f1277, f1278, f1279, f1280, f1281, f1282, f1283, f1284, f1285, f1286, f1287, f1288, f1289, f1290, f1291, f1292, f1293, f1294, f1295, f1296, f1297, f1298, f1299, f1300, f1301, f1302, f1303, f1304, f1305, f1306, f1307, f1308, f1309, f1310, f1311, f1312, f1313, f1314, f1315, f1316, f1317, f1318, f1319, f1320, f1321, f1322, f1323, f1324, f1325, f1326, f1327, f1328, f1329, f1330, f1331, f1332, f1333, f1334, f1335, f1336, f1337, f1338, f1339, f1340, f1341, f1342, f1343, f1344, f1345, f1346, f1347, f1348, f1349, f1350, f1351, f1352, f1353, f1354, f1355, f1356, f1357, f1358, f1359, f1360, f1361, f1362, f1363, f1364, f1365, f1366, f1367, f1368, f1369, f1370, f1371, f1372, f1373, f1374, f1375, f1376, f1377, f1378, f1379, f1380, f1381, f1382, f1383, f1384, f1385, f1386, f1387, f1388, f1389, f1390, f1391, f1392, f1393, f1394, f1395, f1396, f1397, f1398, f1399, f1400, f1401, f1402, f1403, f1404, f1405, f1406, f1407, f1408, f1409, f1410, f1411, f1412, f1413, f1414, f1415, f1416, f1417, f1418, f1419, f1420, f1421, f1422, f1423, f1424, f1425, f1426, f1427, f1428, f1429, f1430, f1431, f1432, f1433, f1434, f1435, f1436, f1437, f1438, f1439, f1440, f1441, f1442, f1443, f1444, f1445, f1446, f1447, f1448, f1449, f1450, f1451, f1452, f1453, f1454, f1455, f1456, f1457, f1458, f1459, f1460, f1461, f1462, f1463, f1464, f1465, f1466, f1467, f1468, f1469, f1470, f1471, f1472, f1473, f1474, f1475, f1476, f1477, f1478, f1479, f1480, f1481, f1482, f1483, f1484, f1485, f1486, f1487, f1488, f1489, f1490, f1491, f1492, f1493, f1494, f1495, f1496, f1497, f1498, f1499, f1500, f1501, f1502, f1503, f1504, f1505, f1506, f1507, f1508, f1509, f1510, f1511, f1512, f1513, f1514, f1515, f1516, f1517, f1518, f1519, f1520, f1521, f1522, f1523, f1524, f1525, f1526, f1527, f1528, f1529, f1530, f1531, f1532, f1533, f1534, f1535, f1536, f1537, f1538, f1539, f1540, f1541, f1542, f1543, f1544, f1545, f1546, f1547, f1548, f1549, f1550, f1551, f1552, f1553, f1554, f1555, f1556, f1557, f1558, f1559, f1560, f1561, f1562, f1563, f1564, f1565, f1566, f1567, f1568, f1569, f1570, f1571, f1572, f1573, f1574, f1575, f1576, f1577, f1578, f1579, f1580, f1581, f1582, f1583, f1584, f1585, f1586, f1587, f1588, f1589, f1590, f1591, f1592, f1593, f1594, f1595, f1596, f1597, f1598, f1599, f1600, f1601, f1602, f1603, f1604, f1605, f1606, f1607, f1608, f1609, f1610, f1611, f1612, f1613, f1614, f1615, f1616, f1617, f1618, f1619, f1620, f1621, f1622, f1623, f1624, f1625, f1626, f1627, f1628, f1629, f1630, f1631, f1632, f1633, f1634, f1635, f1636, f1637, f1638, f1639, f1640, f1641, f1642, f1643, f1644, f1645, f1646, f1647, f1648, f1649, f1650, f1651, f1652, f1653, f1654, f1655, f1656, f1657, f1658, f1659, f1660, f1661, f1662, f1663, f1664, f1665, f1666, f1667, f1668, f1669, f1670, f1671, f1672, f1673, f1674, f1675, f1676, f1677, f1678, f1679, f1680, f1681, f1682, f1683, f1684, f1685, f1686, f1687, f1688, f1689, f1690, f1691, f1692, f1693, f1694, f1695, f1696, f1697, f1698, f1699, f1700, f1701, f1702, f1703, f1704, f1705, f1706, f1707, f1708, f1709, f1710, f1711, f1712, f1713, f1714, f1715, f1716, f1717, f1718, f1719, f1720, f1721, f1722, f1723, f1724, f1725, f1726, f1727, f1728, f1729, f1730, f1731, f1732, f1733, f1734, f1735, f1736, f1737, f1738, f1739, f1740, f1741, f1742, f1743, f1744, f1745, f1746, f1747, f1748, f1749, f1750, f1751, f1752, f1753, f1754, f1755, f1756, f1757, f1758, f1759, f1760, f1761, f1762, f1763, f1764, f1765, f1766, f1767, f1768, f1769, f1770, f1771, f1772, f1773, f1774, f1775, f1776, f1777, f1778, f1779, f1780, f1781, f1782, f1783, f1784, f1785, f1786, f1787, f1788, f1789, f1790, f1791, f1792, f1793, f1794, f1795, f1796, f1797, f1798, f1799, f1800, f1801, f1802, f1803, f1804, f1805, f1806, f1807, f1808, f1809, f1810, f1811, f1812, f1813, f1814, f1815, f1816, f1817, f1818, f1819, f1820, f1821, f1822, f1823, f1824, f1825, f1826, f1827, f1828, f1829, f1830, f1831, f1832, f1833, f1834, f1835, f1836, f1837, f1838, f1839, f1840, f1841, f1842, f1843, f1844, f1845, f1846, f1847, f1848, f1849, f1850, f1851, f1852, f1853, f1854, f1855, f1856, f1857, f1858, f1859, f1860, f1861, f1862, f1863, f1864, f1865, f1866, f1867, f1868, f1869, f1870, f1871, f1872, f1873, f1874, f1875, f1876, f1877, f1878, f1879, f1880, f1881, f1882, f1883, f1884, f1885, f1886, f1887, f1888, f1889, f1890, f1891, f1892, f1893, f1894, f1895, f1896, f1897, f1898, f1899, f1900, f1901, f1902, f1903, f1904, f1905, f1906, f1907, f1908, f1909, f1910, f1911, f1912, f1913, f1914, f1915, f1916, f1917, f1918, f1919, f1920, f1921, f1922, f1923, f1924, f1925, f1926, f1927, f1928, f1929, f1930, f1931, f1932, f1933, f1934, f1935, f1936, f1937, f1938, f1939, f1940, f1941, f1942, f1943, f1944, f1945, f1946, f1947, f1948, f1949, f1950, f1951, f1952, f1953, f1954, f1955, f1956, f1957, f1958, f1959, f1960, f1961, f1962, f1963, f1964, f1965, f1966, f1967, f1968, f1969, f1970, f1971, f1972, f1973, f1974, f1975, f1976, f1977, f1978, f1979, f1980, f1981, f1982, f1983, f1984, f1985, f1986, f1987, f1988, f1989, f1990, f1991, f1992, f1993, f1994, f1995, f1996, f1997, f1998, f1999, f2000, f2001, f2002, f2003, f2004, f2005, f2006, f2007, f2008, f2009, f2010, f2011, f2012, f2013, f2014, f2015, f2016, f2017, f2018, f2019, f2020, f2021, f2022, f2023, f2024, f2025, f2026, f2027, f2028, f2029, f2030, f2031, f2032, f2033, f2034, f2035, f2036, f2037, f2038, f2039, f2040, f2041, f2042, f2043, f2044, f2045, f2046, f2047, f2048, f2049, f2050, f2051, f2052, f2053, f2054, f2055, f2056, f2057, f2058, f2059, f2060, f2061, f2062, f2063, f2064, f2065, f2066, f2067, f2068, f2069, f2070, f2071, f2072, f2073, f2074, f2075, f2076, f2077, f2078, f2079, f2080, f2081, f2082, f2083, f2084, f2085, f2086, f2087, f2088, f2089, f2090, f2091, f2092, f2093, f2094, f2095, f2096, f2097, f2098, f2099, f2100, f2101, f2102, f2103, f2104, f2105, f2106, f2107, f2108, f2109, f2110, f2111, f2112, f2113, f2114, f2115, f2116, f2117, f2118, f2119, f2120, f2121, f2122, f2123, f2124, f2125, f2126, f2127, f2128, f2129, f2130, f2131, f2132, f2133, f2134, f2135, f2136, f2137, f2138, f2139, f2140, f2141, f2142, f2143, f2144, f2145, f2146, f2147, f2148, f2149, f2150, f2151, f2152, f2153, f2154, f2155, f2156, f2157, f2158, f2159, f2160, f2161, f2162, f2163, f2164, f2165, f2166, f2167, f2168, f2169, f2170, f2171, f2172, f2173, f2174, f2175, f2176, f2177, f2178, f2179, f2180, f2181, f2182, f2183, f2184, f2185, f2186, f2187, f2188, f2189, f2190, f2191, f2192, f2193, f2194, f2195, f2196, f2197, f2198, f2199, f2200, f2201, f2202, f2203, f2204, f2205, f2206, f2207, f2208, f2209, f2210, f2211, f2212, f2213, f2214, f2215, f2216, f2217, f2218, f2219, f2220, f2221, f2222, f2223, f2224, f2225, f2226, f2227, f2228, f2229, f2230, f2231, f2232, f2233, f2234, f2235, f2236, f2237, f2238, f2239, f2240, f2241, f2242, f2243, f2244, f2245, f2246, f2247, f2248, f2249, f2250, f2251, f2252, f2253, f2254, f2255, f2256, f2257, f2258, f2259, f2260, f2261, f2262, f2263, f2264, f2265, f2266, f2267, f2268, f2269, f2270, f2271, f2272, f2273, f2274, f2275, f2276, f2277, f2278, f2279, f2280, f2281, f2282, f2283, f2284, f2285, f2286, f2287, f2288, f2289, f2290, f2291, f2292, f2293, f2294, f2295, f2296, f2297, f2298, f2299, f2300, f2301, f2302, f2303, f2304, f2305, f2306, f2307, f2308, f2309, f2310, f2311, f2312, f2313, f2314, f2315, f2316, f2317, f2318, f2319, f2320, f2321, f2322, f2323, f2324, f2325, f2326, f2327, f2328, f2329, f2330, f2331, f2332, f2333, f2334, f2335, f2336, f2337, f2338, f2339, f2340, f2341, f2342, f2343, f2344, f2345, f2346, f2347, f2348, f2349, f2350, f2351, f2352, f2353, f2354, f2355, f2356, f2357, f2358, f2359, f2360, f2361, f2362, f2363, f2364, f2365, f2366, f2367, f2368, f2369, f2370, f2371, f2372, f2373, f2374, f2375, f2376, f2377, f2378, f2379, f2380, f2381, f2382, f2383, f2384, f2385, f2386, f2387, f2388, f2389, f2390, f2391, f2392, f2393, f2394, f2395, f2396, f2397, f2398, f2399, f2400, f2401, f2402, f2403, f2404, f2405, f2406, f2407, f2408, f2409, f2410, f2411, f2412, f2413, f2414, f2415, f2416, f2417, f2418, f2419, f2420, f2421, f2422, f2423, f2424, f2425, f2426, f2427, f2428, f2429, f2430, f2431, f2432, f2433, f2434, f2435, f2436, f2437, f2438, f2439, f2440, f2441, f2442, f2443, f2444, f2445, f2446, f2447, f2448, f2449, f2450, f2451, f2452, f2453, f2454, f2455, f2456, f2457, f2458, f2459, f2460, f2461, f2462, f2463, f2464, f2465, f2466, f2467, f2468, f2469, f2470, f2471, f2472, f2473, f2474, f2475, f2476, f2477, f2478, f2479, f2480, f2481, f2482, f2483, f2484, f2485, f2486, f2487, f2488, f2489, f2490, f2491, f2492, f2493, f2494, f2495, f2496, f2497, f2498, f2499, f2500, f2501, f2502, f2503, f2504, f2505, f2506, f2507, f2508, f2509, f2510, f2511, f2512, f2513, f2514, f2515, f2516, f2517, f2518, f2519, f2520, f2521, f2522, f2523, f2524, f2525, f2526, f2527, f2528, f2529, f2530, f2531, f2532, f2533, f2534, f2535, f2536, f2537, f2538, f2539, f2540, f2541, f2542, f2543, f2544, f2545, f2546, f2547, f2548, f2549, f2550, f2551, f2552, f2553, f2554, f2555, f2556, f2557, f2558, f2559, f2560, f2561, f2562, f2563, f2564, f2565, f2566, f2567, f2568, f2569, f2570, f2571, f2572, f2573, f2574, f2575, f2576, f2577, f2578, f2579, f2580, f2581, f2582, f2583, f2584, f2585, f2586, f2587, f2588, f2589, f2590, f2591, f2592, f2593, f2594, f2595, f2596, f2597, f2598, f2599, f2600, f2601, f2602, f2603, f2604, f2605, f2606, f2607, f2608, f2609, f2610, f2611, f2612, f2613, f2614, f2615, f2616, f2617, f2618, f2619, f2620, f2621, f2622, f2623, f2624, f2625, f2626, f2627, f2628, f2629, f2630, f2631, f2632, f2633, f2634, f2635, f2636, f2637, f2638, f2639, f2640, f2641, f2642, f2643, f2644, f2645, f2646, f2647, f2648, f2649, f2650, f2651, f2652, f2653, f2654, f2655, f2656, f2657, f2658, f2659, f2660, f2661, f2662, f2663, f2664, f2665, f2666, f2667, f2668, f2669, f2670, f2671, f2672, f2673, f2674, f2675, f2676, f2677, f2678, f2679, f2680, f2681, f2682, f2683, f2684, f2685, f2686, f2687, f2688, f2689, f2690, f2691, f2692, f2693, f2694, f2695, f2696, f2697, f2698, f2699, f2700, f2701, f2702, f2703, f2704, f2705, f2706, f2707, f2708, f2709, f2710, f2711, f2712, f2713, f2714, f2715, f2716, f2717, f2718, f2719, f2720, f2721, f2722, f2723, f2724, f2725, f2726, f2727, f2728, f2729, f2730, f2731, f2732, f2733, f2734, f2735, f2736, f2737, f2738, f2739, f2740, f2741, f2742, f2743, f2744, f2745, f2746, f2747, f2748, f2749, f2750, f2751, f2752, f2753, f2754, f2755, f2756, f2757, f2758, f2759, f2760, f2761, f2762, f2763, f2764, f2765, f2766, f2767, f2768, f2769, f2770, f2771, f2772, f2773, f2774, f2775, f2776, f2777, f2778, f2779, f2780, f2781, f2782, f2783, f2784, f2785, f2786, f2787, f2788, f2789, f2790, f2791, f2792, f2793, f2794, f2795, f2796, f2797, f2798, f2799, f2800, f2801, f2802, f2803, f2804, f2805, f2806, f2807, f2808, f2809, f2810, f2811, f2812, f2813, f2814, f2815, f2816, f2817, f2818, f2819, f2820, f2821, f2822, f2823, f2824, f2825, f2826, f2827, f2828, f2829, f2830, f2831, f2832, f2833, f2834, f2835, f2836, f2837, f2838, f2839, f2840, f2841, f2842, f2843, f2844, f2845, f2846, f2847, f2848, f2849, f2850, f2851, f2852, f2853, f2854, f2855, f2856, f2857, f2858, f2859, f2860, f2861, f2862, f2863, f2864, f2865, f2866, f2867, f2868, f2869, f2870, f2871, f2872, f2873, f2874, f2875, f2876, f2877, f2878, f2879, f2880, f2881, f2882, f2883, f2884, f2885, f2886, f2887, f2888, f2889, f2890, f2891, f2892, f2893, f2894, f2895, f2896, f2897, f2898, f2899, f2900, f2901, f2902, f2903, f2904, f2905, f2906, f2907, f2908, f2909, f2910, f2911, f2912, f2913, f2914, f2915, f2916, f2917, f2918, f2919, f2920, f2921, f2922, f2923, f2924, f2925, f2926, f2927, f2928, f2929, f2930, f2931, f2932, f2933, f2934, f2935, f2936, f2937, f2938, f2939, f2940, f2941, f2942, f2943, f2944, f2945, f2946, f2947, f2948, f2949, f2950, f2951, f2952, f2953, f2954, f2955, f2956, f2957, f2958, f2959, f2960, f2961, f2962, f2963, f2964, f2965, f2966, f2967, f2968, f2969, f2970, f2971, f2972, f2973, f2974, f2975, f2976, f2977, f2978, f2979, f2980, f2981, f2982, f2983, f2984, f2985, f2986, f2987, f2988, f2989, f2990, f2991, f2992, f2993, f2994, f2995, f2996, f2997, f2998, f2999, f3000, f3001, f3002, f3003, f3004, f3005, f3006, f3007, f3008, f3009, f3010, f3011, f3012, f3013, f3014, f3015, f3016, f3017, f3018, f3019, f3020, f3021, f3022, f3023, f3024, f3025, f3026, f3027, f3028, f3029, f3030, f3031, f3032, f3033, f3034, f3035, f3036, f3037, f3038, f3039, f3040, f3041, f3042, f3043, f3044, f3045, f3046, f3047, f3048, f3049, f3050, f3051, f3052, f3053, f3054, f3055, f3056, f3057, f3058, f3059, f3060, f3061, f3062, f3063, f3064, f3065, f3066, f3067, f3068, f3069, f3070, f3071, f3072, f3073, f3074, f3075, f3076, f3077, f3078, f3079, f3080, f3081, f3082, f3083, f3084, f3085, f3086, f3087, f3088, f3089, f3090, f3091, f3092, f3093, f3094, f3095, f3096, f3097, f3098, f3099, f3100, f3101, f3102, f3103, f3104, f3105, f3106, f3107, f3108, f3109, f3110, f3111, f3112, f3113, f3114, f3115, f3116, f3117, f3118, f3119, f3120, f3121, f3122, f3123, f3124, f3125, f3126, f3127, f3128, f3129, f3130, f3131, f3132, f3133, f3134, f3135, f3136, f3137, f3138, f3139, f3140, f3141, f3142, f3143, f3144, f3145, f3146, f3147, f3148, f3149, f3150, f3151, f3152, f3153, f3154, f3155, f3156, f3157, f3158, f3159, f3160, f3161, f3162, f3163, f3164, f3165, f3166, f3167, f3168, f3169, f3170, f3171, f3172, f3173, f3174, f3175, f3176, f3177, f3178, f3179, f3180, f3181, f3182, f3183, f3184, f3185, f3186, f3187, f3188, f3189, f3190, f3191, f3192, f3193, f3194, f3195, f3196, f3197, f3198, f3199, f3200, f3201, f3202, f3203, f3204, f3205, f3206, f3207, f3208, f3209, f3210, f3211, f3212, f3213, f3214, f3215, f3216, f3217, f3218, f3219, f3220, f3221, f3222, f3223, f3224, f3225, f3226, f3227, f3228, f3229, f3230, f3231, f3232, f3233, f3234, f3235, f3236, f3237, f3238, f3239, f3240, f3241, f3242, f3243, f3244, f3245, f3246, f3247, f3248, f3249, f3250, f3251, f3252, f3253, f3254, f3255, f3256, f3257, f3258, f3259, f3260, f3261, f3262, f3263, f3264, f3265, f3266, f3267, f3268, f3269, f3270, f3271, f3272, f3273, f3274, f3275, f3276, f3277, f3278, f3279, f3280, f3281, f3282, f3283, f3284, f3285, f3286, f3287, f3288, f3289, f3290, f3291, f3292, f3293, f3294, f3295, f3296, f3297, f3298, f3299, f3300, f3301, f3302, f3303, f3304, f3305, f3306, f3307, f3308, f3309, f3310, f3311, f3312, f3313, f3314, f3315, f3316, f3317, f3318, f3319, f3320, f3321, f3322, f3323, f3324, f3325, f3326, f3327, f3328, f3329, f3330, f3331, f3332, f3333, f3334, f3335, f3336, f3337, f3338, f3339, f3340, f3341, f3342, f3343, f3344, f3345, f3346, f3347, f3348, f3349, f3350, f3351, f3352, f3353, f3354, f3355, f3356, f3357, f3358, f3359, f3360, f3361, f3362, f3363, f3364, f3365, f3366, f3367, f3368, f3369, f3370, f3371, f3372, f3373, f3374, f3375, f3376, f3377, f3378, f3379, f3380, f3381, f3382, f3383, f3384, f3385, f3386, f3387, f3388, f3389, f3390, f3391, f3392, f3393, f3394, f3395, f3396, f3397, f3398, f3399, f3400, f3401, f3402, f3403, f3404, f3405, f3406, f3407, f3408, f3409, f3410, f3411, f3412, f3413, f3414, f3415, f3416, f3417, f3418, f3419, f3420, f3421, f3422, f3423, f3424, f3425, f3426, f3427, f3428, f3429, f3430, f3431, f3432, f3433, f3434, f3435, f3436, f3437, f3438, f3439, f3440, f3441, f3442, f3443, f3444, f3445, f3446, f3447, f3448, f3449, f3450, f3451, f3452, f3453, f3454, f3455, f3456, f3457, f3458, f3459, f3460, f3461, f3462, f3463, f3464, f3465, f3466, f3467, f3468, f3469, f3470, f3471, f3472, f3473, f3474, f3475, f3476, f3477, f3478, f3479, f3480, f3481, f3482, f3483, f3484, f3485, f3486, f3487, f3488, f3489, f3490, f3491, f3492, f3493, f3494, f3495, f3496, f3497, f3498, f3499, f3500, f3501, f3502, f3503, f3504, f3505, f3506, f3507, f3508, f3509, f3510, f3511, f3512, f3513, f3514, f3515, f3516, f3517, f3518, f3519, f3520, f3521, f3522, f3523, f3524, f3525, f3526, f3527, f3528, f3529, f3530, f3531, f3532, f3533, f3534, f3535, f3536, f3537, f3538, f3539, f3540, f3541, f3542, f3543, f3544, f3545, f3546, f3547, f3548, f3549, f3550, f3551, f3552, f3553, f3554, f3555, f3556, f3557, f3558, f3559, f3560, f3561, f3562, f3563, f3564, f3565, f3566, f3567, f3568, f3569, f3570, f3571, f3572, f3573, f3574, f3575, f3576, f3577, f3578, f3579, f3580, f3581, f3582, f3583, f3584, f3585, f3586, f3587, f3588, f3589, f3590, f3591, f3592, f3593, f3594, f3595, f3596, f3597, f3598, f3599, f3600, f3601, f3602, f3603, f3604, f3605, f3606, f3607, f3608, f3609, f3610, f3611, f3612, f3613, f3614, f3615, f3616, f3617, f3618, f3619, f3620, f3621, f3622, f3623, f3624, f3625, f3626, f3627, f3628, f3629, f3630, f3631, f3632, f3633, f3634, f3635, f3636, f3637, f3638, f3639, f3640, f3641, f3642, f3643, f3644, f3645, f3646, f3647, f3648, f3649, f3650, f3651, f3652, f3653, f3654, f3655, f3656, f3657, f3658, f3659, f3660, f3661, f3662, f3663, f3664, f3665, f3666, f3667, f3668, f3669, f3670, f3671, f3672, f3673, f3674, f3675, f3676, f3677, f3678, f3679, f3680, f3681, f3682, f3683, f3684, f3685, f3686, f3687, f3688, f3689, f3690, f3691, f3692, f3693, f3694, f3695, f3696, f3697, f3698, f3699, f3700, f3701, f3702, f3703, f3704, f3705, f3706, f3707, f3708, f3709, f3710, f3711, f3712, f3713, f3714, f3715, f3716, f3717, f3718, f3719, f3720, f3721, f3722, f3723, f3724, f3725, f3726, f3727, f3728, f3729, f3730, f3731, f3732, f3733, f3734, f3735, f3736, f3737, f3738, f3739, f3740, f3741, f3742, f3743, f3744, f3745, f3746, f3747, f3748, f3749, f3750, f3751, f3752, f3753, f3754, f3755, f3756, f3757, f3758, f3759, f3760, f3761, f3762, f3763, f3764, f3765, f3766, f3767, f3768, f3769, f3770, f3771, f3772, f3773, f3774, f3775, f3776, f3777, f3778, f3779, f3780, f3781, f3782, f3783, f3784, f3785, f3786, f3787, f3788, f3789, f3790, f3791, f3792, f3793, f3794, f3795, f3796, f3797, f3798, f3799, f3800, f3801, f3802, f3803, f3804, f3805, f3806, f3807, f3808, f3809, f3810, f3811, f3812, f3813, f3814, f3815, f3816, f3817, f3818, f3819, f3820, f3821, f3822, f3823, f3824, f3825, f3826, f3827, f3828, f3829, f3830, f3831, f3832, f3833, f3834, f3835, f3836, f3837, f3838, f3839, f3840, f3841, f3842, f3843, f3844, f3845, f3846, f3847, f3848, f3849, f3850, f3851, f3852, f3853, f3854, f3855, f3856, f3857, f3858, f3859, f3860, f3861, f3862, f3863, f3864, f3865, f3866, f3867, f3868, f3869, f3870, f3871, f3872, f3873, f3874, f3875, f3876, f3877, f3878, f3879, f3880, f3881, f3882, f3883, f3884, f3885, f3886, f3887, f3888, f3889, f3890, f3891, f3892, f3893, f3894, f3895, f3896, f3897, f3898, f3899, f3900, f3901, f3902, f3903, f3904, f3905, f3906, f3907, f3908, f3909, f3910, f3911, f3912, f3913, f3914, f3915, f3916, f3917, f3918, f3919, f3920, f3921, f3922, f3923, f3924, f3925, f3926, f3927, f3928, f3929, f3930, f3931, f3932, f3933, f3934, f3935, f3936, f3937, f3938, f3939, f3940, f3941, f3942, f3943, f3944, f3945, f3946, f3947, f3948, f3949, f3950, f3951, f3952, f3953, f3954, f3955, f3956, f3957, f3958, f3959, f3960, f3961, f3962, f3963, f3964, f3965, f3966, f3967, f3968, f3969, f3970, f3971, f3972, f3973, f3974, f3975, f3976, f3977, f3978, f3979, f3980, f3981, f3982, f3983, f3984, f3985, f3986, f3987, f3988, f3989, f3990, f3991, f3992, f3993, f3994, f3995, f3996, f3997, f3998, f3999, f4000, f4001, f4002, f4003, f4004, f4005, f4006, f4007, f4008, f4009, f4010, f4011, f4012, f4013, f4014, f4015, f4016, f4017, f4018, f4019, f4020, f4021, f4022, f4023, f4024, f4025, f4026, f4027, f4028, f4029, f4030, f4031, f4032, f4033, f4034, f4035, f4036, f4037, f4038, f4039, f4040, f4041, f4042, f4043, f4044, f4045, f4046, f4047, f4048, f4049, f4050, f4051, f4052, f4053, f4054, f4055, f4056, f4057, f4058, f4059, f4060, f4061, f4062, f4063, f4064, f4065, f4066, f4067, f4068, f4069, f4070, f4071, f4072, f4073, f4074, f4075, f4076, f4077, f4078, f4079, f4080, f4081, f4082, f4083, f4084, f4085, f4086, f4087, f4088, f4089, f4090, f4091, f4092, f4093, f4094, f4095, f4096, f4097, f4098, f4099, f4100, f4101, f4102, f4103, f4104, f4105, f4106, f4107, f4108, f4109, f4110, f4111, f4112, f4113, f4114, f4115, f4116, f4117, f4118, f4119, f4120, f4121, f4122, f4123, f4124, f4125, f4126, f4127, f4128, f4129, f4130, f4131, f4132, f4133, f4134, f4135, f4136, f4137, f4138, f4139, f4140, f4141, f4142, f4143, f4144, f4145, f4146, f4147, f4148, f4149, f4150, f4151, f4152, f4153, f4154, f4155, f4156, f4157, f4158, f4159, f4160, f4161, f4162, f4163, f4164, f4165, f4166, f4167, f4168, f4169, f4170, f4171, f4172, f4173, f4174, f4175, f4176, f4177, f4178, f4179, f4180, f4181, f4182, f4183, f4184, f4185, f4186, f4187, f4188, f4189, f4190, f4191, f4192, f4193, f4194, f4195, f4196, f4197, f4198, f4199, f4200, f4201, f4202, f4203, f4204, f4205, f4206, f4207, f4208, f4209, f4210, f4211, f4212, f4213, f4214, f4215, f4216, f4217, f4218, f4219, f4220, f4221, f4222, f4223, f4224, f4225, f4226, f4227, f4228, f4229, f4230, f4231, f4232, f4233, f4234, f4235, f4236, f4237, f4238, f4239, f4240, f4241, f4242, f4243, f4244, f4245, f4246, f4247, f4248, f4249, f4250, f4251, f4252, f4253, f4254, f4255, f4256, f4257, f4258, f4259, f4260, f4261, f4262, f4263, f4264, f4265, f4266, f4267, f4268, f4269, f4270, f4271, f4272, f4273, f4274, f4275, f4276, f4277, f4278, f4279, f4280, f4281, f4282, f4283, f4284, f4285, f4286, f4287, f4288, f4289, f4290, f4291, f4292, f4293, f4294, f4295, f4296, f4297, f4298, f4299, f4300, f4301, f4302, f4303, f4304, f4305, f4306, f4307, f4308, f4309, f4310, f4311, f4312, f4313, f4314, f4315, f4316, f4317, f4318, f4319, f4320, f4321, f4322, f4323, f4324, f4325, f4326, f4327, f4328, f4329, f4330, f4331, f4332, f4333, f4334, f4335, f4336, f4337, f4338, f4339, f4340, f4341, f4342, f4343, f4344, f4345, f4346, f4347, f4348, f4349, f4350, f4351, f4352, f4353, f4354, f4355, f4356, f4357, f4358, f4359, f4360, f4361, f4362, f4363, f4364, f4365, f4366, f4367, f4368, f4369, f4370, f4371, f4372, f4373, f4374, f4375, f4376, f4377, f4378, f4379, f4380, f4381, f4382, f4383, f4384, f4385, f4386, f4387, f4388, f4389, f4390, f4391, f4392, f4393, f4394, f4395, f4396, f4397, f4398, f4399, f4400, f4401, f4402, f4403, f4404, f4405, f4406, f4407, f4408, f4409, f4410, f4411, f4412, f4413, f4414, f4415, f4416, f4417, f4418, f4419, f4420, f4421, f4422, f4423, f4424, f4425, f4426, f4427, f4428, f4429, f4430, f4431, f4432, f4433, f4434, f4435, f4436, f4437, f4438, f4439, f4440, f4441, f4442, f4443, f4444, f4445, f4446, f4447, f4448, f4449, f4450, f4451, f4452, f4453, f4454, f4455, f4456, f4457, f4458, f4459, f4460, f4461, f4462, f4463, f4464, f4465, f4466, f4467, f4468, f4469, f4470, f4471, f4472, f4473, f4474, f4475, f4476, f4477, f4478, f4479, f4480, f4481, f4482, f4483, f4484, f4485, f4486, f4487, f4488, f4489, f4490, f4491, f4492, f4493, f4494, f4495, f4496, f4497, f4498, f4499, f4500, f4501, f4502, f4503, f4504, f4505, f4506, f4507, f4508, f4509, f4510, f4511, f4512, f4513, f4514, f4515, f4516, f4517, f4518, f4519, f4520, f4521, f4522, f4523, f4524, f4525, f4526, f4527, f4528, f4529, f4530, f4531, f4532, f4533, f4534, f4535, f4536, f4537, f4538, f4539, f4540, f4541, f4542, f4543, f4544, f4545, f4546, f4547, f4548, f4549, f4550, f4551, f4552, f4553, f4554, f4555, f4556, f4557, f4558, f4559, f4560, f4561, f4562, f4563, f4564, f4565, f4566, f4567, f4568, f4569, f4570, f4571, f4572, f4573, f4574, f4575, f4576, f4577, f4578, f4579, f4580, f4581, f4582, f4583, f4584, f4585, f4586, f4587, f4588, f4589, f4590, f4591, f4592, f4593, f4594, f4595, f4596, f4597, f4598, f4599, f4600, f4601, f4602, f4603, f4604, f4605, f4606, f4607, f4608, f4609, f4610, f4611, f4612, f4613, f4614, f4615, f4616, f4617, f4618, f4619, f4620, f4621, f4622, f4623, f4624, f4625, f4626, f4627, f4628, f4629, f4630, f4631, f4632, f4633, f4634, f4635, f4636, f4637, f4638, f4639, f4640, f4641, f4642, f4643, f4644, f4645, f4646, f4647, f4648, f4649, f4650, f4651, f4652, f4653, f4654, f4655, f4656, f4657, f4658, f4659, f4660, f4661, f4662, f4663, f4664, f4665, f4666, f4667, f4668, f4669, f4670, f4671, f4672, f4673, f4674, f4675, f4676, f4677, f4678, f4679, f4680, f4681, f4682, f4683, f4684, f4685, f4686, f4687, f4688, f4689, f4690, f4691, f4692, f4693, f4694, f4695, f4696, f4697, f4698, f4699, f4700, f4701, f4702, f4703, f4704, f4705, f4706, f4707, f4708, f4709, f4710, f4711, f4712, f4713, f4714, f4715, f4716, f4717, f4718, f4719, f4720, f4721, f4722, f4723, f4724, f4725, f4726, f4727, f4728, f4729, f4730, f4731, f4732, f4733, f4734, f4735, f4736, f4737, f4738, f4739, f4740, f4741, f4742, f4743, f4744, f4745, f4746, f4747, f4748, f4749, f4750, f4751, f4752, f4753, f4754, f4755, f4756, f4757, f4758, f4759, f4760, f4761, f4762, f4763, f4764, f4765, f4766, f4767, f4768, f4769, f4770, f4771, f4772, f4773, f4774, f4775, f4776, f4777, f4778, f4779, f4780, f4781, f4782, f4783, f4784, f4785, f4786, f4787, f4788, f4789, f4790, f4791, f4792, f4793, f4794, f4795, f4796, f4797, f4798, f4799, f4800, f4801, f4802, f4803, f4804, f4805, f4806, f4807, f4808, f4809, f4810, f4811, f4812, f4813, f4814, f4815, f4816, f4817, f4818, f4819, f4820, f4821, f4822, f4823, f4824, f4825, f4826, f4827, f4828, f4829, f4830, f4831, f4832, f4833, f4834, f4835, f4836, f4837, f4838, f4839, f4840, f4841, f4842, f4843, f4844, f4845, f4846, f4847, f4848, f4849, f4850, f4851, f4852, f4853, f4854, f4855, f4856, f4857, f4858, f4859, f4860, f4861, f4862, f4863, f4864, f4865, f4866, f4867, f4868, f4869, f4870, f4871, f4872, f4873, f4874, f4875, f4876, f4877, f4878, f4879, f4880, f4881, f4882, f4883, f4884, f4885, f4886, f4887, f4888, f4889, f4890, f4891, f4892, f4893, f4894, f4895, f4896, f4897, f4898, f4899, f4900, f4901, f4902, f4903, f4904, f4905, f4906, f4907, f4908, f4909, f4910, f4911, f4912, f4913, f4914, f4915, f4916, f4917, f4918, f4919, f4920, f4921, f4922, f4923, f4924, f4925, f4926, f4927, f4928, f4929, f4930, f4931, f4932, f4933, f4934, f4935, f4936, f4937, f4938, f4939];
let line = ""; let count = 0;
for (const f of all) for (let x = 0; x < 2; x++) { const p = f(x); line += Object.keys(p).join("") + ":" + [p.a, p.b, p.c, p.d].join() + " "; if (++count % 24 === 0) { console.log(line); line = ""; } }
console.log(line);
