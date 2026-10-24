// Members, elements, parameters and results of function types that hold no function are called: a TypeError wherever the call stands, also where it is the last thing its function does.
declare const console: any;
type Fn = (x: number, b?: number, c?: number, d?: number, e?: number, f?: number, g?: number, h?: number, i?: number) => number;
interface Holder { absent?: Fn; orUndefined: Fn | undefined; orNull: Fn | null; }
const inc: Fn = x => x + 1;
const twice: Fn = x => x * 2;
const proxied: Fn = new Proxy(inc, {});
const bound: Fn = inc.bind(null);
const revocable = Proxy.revocable(inc, {}); revocable.revoke(); const revoked: Fn = revocable.proxy;
const pair: [number, number] = [1, 2];
function read_absent(h: Holder): Fn | undefined { return h.absent; }
function read_orUndefined(h: Holder): Fn | undefined { return h.orUndefined; }
function read_orNull(h: Holder): Fn | null { return h.orNull; }
function r0(h: Holder, a: (Fn | undefined)[], p?: Fn) { const v = h.absent; return v!(1); }
function r1(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { const v = h.absent; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r2(h: Holder, a: (Fn | undefined)[], p?: Fn) { const v = h.absent; var r: number; r = v!(1); return r; }
function r3(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { const v = h.absent; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r4(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(1); }
function r5(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r6(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(1); return r; }
function r7(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r8(h: Holder, a: (Fn | undefined)[], p?: Fn) { return a[0]!(1); }
function r9(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r10(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = a[0]!(1); return r; }
function r11(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r12(h: Holder, a: (Fn | undefined)[], p?: Fn) { return p!(1); }
function r13(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r14(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = p!(1); return r; }
function r15(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r16(h: Holder, a: (Fn | undefined)[], p?: Fn) { return read_absent(h)!(1); }
function r17(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return read_absent(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r18(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = read_absent(h)!(1); return r; }
function r19(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = read_absent(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r20(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function r21(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r22(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function r23(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r24(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(...pair); }
function r25(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r26(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(...pair); return r; }
function r27(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r28(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { const v = h.absent; return v!(1); }; return inner(); }
function r29(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { const v = h.absent; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r30(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { const v = h.absent; var r: number; r = v!(1); return r; }; return inner(); }
function r31(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { const v = h.absent; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r32(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { return h.absent!(1); }; return inner(); }
function r33(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { return h.absent!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r34(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { var r: number; r = h.absent!(1); return r; }; return inner(); }
function r35(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { var r: number; r = h.absent!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r36(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { return a[0]!(1); }; return inner(); }
function r37(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r38(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { var r: number; r = a[0]!(1); return r; }; return inner(); }
function r39(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r40(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { return p!(1); }; return inner(); }
function r41(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r42(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { var r: number; r = p!(1); return r; }; return inner(); }
function r43(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r44(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { return read_absent(h)!(1); }; return inner(); }
function r45(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { return read_absent(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r46(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { var r: number; r = read_absent(h)!(1); return r; }; return inner(); }
function r47(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { var r: number; r = read_absent(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r48(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); }; return inner(); }
function r49(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r50(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }; return inner(); }
function r51(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r52(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { return h.absent!(...pair); }; return inner(); }
function r53(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { return h.absent!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r54(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { var r: number; r = h.absent!(...pair); return r; }; return inner(); }
function r55(h: Holder, a: (Fn | undefined)[], p?: Fn) { const inner = () => { try { var r: number; r = h.absent!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
async function r56(h: Holder, a: (Fn | undefined)[], p?: Fn) { const v = h.absent; return v!(1); }
async function r57(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { const v = h.absent; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r58(h: Holder, a: (Fn | undefined)[], p?: Fn) { const v = h.absent; var r: number; r = v!(1); return r; }
async function r59(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { const v = h.absent; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r60(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(1); }
async function r61(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r62(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(1); return r; }
async function r63(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r64(h: Holder, a: (Fn | undefined)[], p?: Fn) { return a[0]!(1); }
async function r65(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r66(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = a[0]!(1); return r; }
async function r67(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r68(h: Holder, a: (Fn | undefined)[], p?: Fn) { return p!(1); }
async function r69(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r70(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = p!(1); return r; }
async function r71(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r72(h: Holder, a: (Fn | undefined)[], p?: Fn) { return read_absent(h)!(1); }
async function r73(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return read_absent(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r74(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = read_absent(h)!(1); return r; }
async function r75(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = read_absent(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r76(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
async function r77(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r78(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
async function r79(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r80(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(...pair); }
async function r81(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r82(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(...pair); return r; }
async function r83(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r84(h: Holder, a: (Fn | undefined)[], p?: Fn) { const v = h.absent; return v!(1); }
function* r85(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { const v = h.absent; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r86(h: Holder, a: (Fn | undefined)[], p?: Fn) { const v = h.absent; var r: number; r = v!(1); return r; }
function* r87(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { const v = h.absent; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r88(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(1); }
function* r89(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r90(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(1); return r; }
function* r91(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r92(h: Holder, a: (Fn | undefined)[], p?: Fn) { return a[0]!(1); }
function* r93(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r94(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = a[0]!(1); return r; }
function* r95(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r96(h: Holder, a: (Fn | undefined)[], p?: Fn) { return p!(1); }
function* r97(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r98(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = p!(1); return r; }
function* r99(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r100(h: Holder, a: (Fn | undefined)[], p?: Fn) { return read_absent(h)!(1); }
function* r101(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return read_absent(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r102(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = read_absent(h)!(1); return r; }
function* r103(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = read_absent(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r104(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function* r105(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r106(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function* r107(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r108(h: Holder, a: (Fn | undefined)[], p?: Fn) { return h.absent!(...pair); }
function* r109(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { return h.absent!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r110(h: Holder, a: (Fn | undefined)[], p?: Fn) { var r: number; r = h.absent!(...pair); return r; }
function* r111(h: Holder, a: (Fn | undefined)[], p?: Fn) { try { var r: number; r = h.absent!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r112(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const v = h.orUndefined; return v!(1); }
function r113(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { const v = h.orUndefined; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r114(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const v = h.orUndefined; var r: number; r = v!(1); return r; }
function r115(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { const v = h.orUndefined; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r116(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(1); }
function r117(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r118(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(1); return r; }
function r119(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r120(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return a[0]!(1); }
function r121(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r122(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = a[0]!(1); return r; }
function r123(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r124(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return p!(1); }
function r125(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r126(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = p!(1); return r; }
function r127(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r128(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return read_orUndefined(h)!(1); }
function r129(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return read_orUndefined(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r130(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = read_orUndefined(h)!(1); return r; }
function r131(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = read_orUndefined(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r132(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function r133(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r134(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function r135(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r136(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(...pair); }
function r137(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r138(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(...pair); return r; }
function r139(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r140(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { const v = h.orUndefined; return v!(1); }; return inner(); }
function r141(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { const v = h.orUndefined; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r142(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { const v = h.orUndefined; var r: number; r = v!(1); return r; }; return inner(); }
function r143(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { const v = h.orUndefined; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r144(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { return h.orUndefined!(1); }; return inner(); }
function r145(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { return h.orUndefined!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r146(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { var r: number; r = h.orUndefined!(1); return r; }; return inner(); }
function r147(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { var r: number; r = h.orUndefined!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r148(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { return a[0]!(1); }; return inner(); }
function r149(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r150(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { var r: number; r = a[0]!(1); return r; }; return inner(); }
function r151(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r152(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { return p!(1); }; return inner(); }
function r153(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r154(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { var r: number; r = p!(1); return r; }; return inner(); }
function r155(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r156(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { return read_orUndefined(h)!(1); }; return inner(); }
function r157(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { return read_orUndefined(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r158(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { var r: number; r = read_orUndefined(h)!(1); return r; }; return inner(); }
function r159(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { var r: number; r = read_orUndefined(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r160(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); }; return inner(); }
function r161(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r162(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }; return inner(); }
function r163(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r164(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { return h.orUndefined!(...pair); }; return inner(); }
function r165(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { return h.orUndefined!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r166(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { var r: number; r = h.orUndefined!(...pair); return r; }; return inner(); }
function r167(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const inner = () => { try { var r: number; r = h.orUndefined!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
async function r168(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const v = h.orUndefined; return v!(1); }
async function r169(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { const v = h.orUndefined; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r170(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const v = h.orUndefined; var r: number; r = v!(1); return r; }
async function r171(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { const v = h.orUndefined; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r172(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(1); }
async function r173(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r174(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(1); return r; }
async function r175(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r176(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return a[0]!(1); }
async function r177(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r178(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = a[0]!(1); return r; }
async function r179(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r180(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return p!(1); }
async function r181(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r182(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = p!(1); return r; }
async function r183(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r184(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return read_orUndefined(h)!(1); }
async function r185(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return read_orUndefined(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r186(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = read_orUndefined(h)!(1); return r; }
async function r187(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = read_orUndefined(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r188(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
async function r189(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r190(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
async function r191(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r192(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(...pair); }
async function r193(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r194(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(...pair); return r; }
async function r195(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r196(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const v = h.orUndefined; return v!(1); }
function* r197(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { const v = h.orUndefined; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r198(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { const v = h.orUndefined; var r: number; r = v!(1); return r; }
function* r199(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { const v = h.orUndefined; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r200(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(1); }
function* r201(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r202(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(1); return r; }
function* r203(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r204(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return a[0]!(1); }
function* r205(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r206(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = a[0]!(1); return r; }
function* r207(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r208(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return p!(1); }
function* r209(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r210(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = p!(1); return r; }
function* r211(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r212(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return read_orUndefined(h)!(1); }
function* r213(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return read_orUndefined(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r214(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = read_orUndefined(h)!(1); return r; }
function* r215(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = read_orUndefined(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r216(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function* r217(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r218(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function* r219(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r220(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { return h.orUndefined!(...pair); }
function* r221(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { return h.orUndefined!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r222(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { var r: number; r = h.orUndefined!(...pair); return r; }
function* r223(h: Holder, a: (Fn | undefined)[], p?: Fn | undefined) { try { var r: number; r = h.orUndefined!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r224(h: Holder, a: (Fn | null)[], p?: Fn | null) { const v = h.orNull; return v!(1); }
function r225(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { const v = h.orNull; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r226(h: Holder, a: (Fn | null)[], p?: Fn | null) { const v = h.orNull; var r: number; r = v!(1); return r; }
function r227(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { const v = h.orNull; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r228(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(1); }
function r229(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r230(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(1); return r; }
function r231(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r232(h: Holder, a: (Fn | null)[], p?: Fn | null) { return a[0]!(1); }
function r233(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r234(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = a[0]!(1); return r; }
function r235(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r236(h: Holder, a: (Fn | null)[], p?: Fn | null) { return p!(1); }
function r237(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r238(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = p!(1); return r; }
function r239(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r240(h: Holder, a: (Fn | null)[], p?: Fn | null) { return read_orNull(h)!(1); }
function r241(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return read_orNull(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r242(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = read_orNull(h)!(1); return r; }
function r243(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = read_orNull(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r244(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function r245(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r246(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function r247(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r248(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(...pair); }
function r249(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r250(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(...pair); return r; }
function r251(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r252(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { const v = h.orNull; return v!(1); }; return inner(); }
function r253(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { const v = h.orNull; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r254(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { const v = h.orNull; var r: number; r = v!(1); return r; }; return inner(); }
function r255(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { const v = h.orNull; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r256(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { return h.orNull!(1); }; return inner(); }
function r257(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { return h.orNull!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r258(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { var r: number; r = h.orNull!(1); return r; }; return inner(); }
function r259(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { var r: number; r = h.orNull!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r260(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { return a[0]!(1); }; return inner(); }
function r261(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r262(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { var r: number; r = a[0]!(1); return r; }; return inner(); }
function r263(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r264(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { return p!(1); }; return inner(); }
function r265(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r266(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { var r: number; r = p!(1); return r; }; return inner(); }
function r267(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r268(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { return read_orNull(h)!(1); }; return inner(); }
function r269(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { return read_orNull(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r270(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { var r: number; r = read_orNull(h)!(1); return r; }; return inner(); }
function r271(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { var r: number; r = read_orNull(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r272(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); }; return inner(); }
function r273(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r274(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }; return inner(); }
function r275(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r276(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { return h.orNull!(...pair); }; return inner(); }
function r277(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { return h.orNull!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r278(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { var r: number; r = h.orNull!(...pair); return r; }; return inner(); }
function r279(h: Holder, a: (Fn | null)[], p?: Fn | null) { const inner = () => { try { var r: number; r = h.orNull!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
async function r280(h: Holder, a: (Fn | null)[], p?: Fn | null) { const v = h.orNull; return v!(1); }
async function r281(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { const v = h.orNull; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r282(h: Holder, a: (Fn | null)[], p?: Fn | null) { const v = h.orNull; var r: number; r = v!(1); return r; }
async function r283(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { const v = h.orNull; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r284(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(1); }
async function r285(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r286(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(1); return r; }
async function r287(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r288(h: Holder, a: (Fn | null)[], p?: Fn | null) { return a[0]!(1); }
async function r289(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r290(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = a[0]!(1); return r; }
async function r291(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r292(h: Holder, a: (Fn | null)[], p?: Fn | null) { return p!(1); }
async function r293(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r294(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = p!(1); return r; }
async function r295(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r296(h: Holder, a: (Fn | null)[], p?: Fn | null) { return read_orNull(h)!(1); }
async function r297(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return read_orNull(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r298(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = read_orNull(h)!(1); return r; }
async function r299(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = read_orNull(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r300(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
async function r301(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r302(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
async function r303(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r304(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(...pair); }
async function r305(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r306(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(...pair); return r; }
async function r307(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r308(h: Holder, a: (Fn | null)[], p?: Fn | null) { const v = h.orNull; return v!(1); }
function* r309(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { const v = h.orNull; return v!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r310(h: Holder, a: (Fn | null)[], p?: Fn | null) { const v = h.orNull; var r: number; r = v!(1); return r; }
function* r311(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { const v = h.orNull; var r: number; r = v!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r312(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(1); }
function* r313(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r314(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(1); return r; }
function* r315(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r316(h: Holder, a: (Fn | null)[], p?: Fn | null) { return a[0]!(1); }
function* r317(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return a[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r318(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = a[0]!(1); return r; }
function* r319(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = a[0]!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r320(h: Holder, a: (Fn | null)[], p?: Fn | null) { return p!(1); }
function* r321(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return p!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r322(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = p!(1); return r; }
function* r323(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = p!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r324(h: Holder, a: (Fn | null)[], p?: Fn | null) { return read_orNull(h)!(1); }
function* r325(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return read_orNull(h)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r326(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = read_orNull(h)!(1); return r; }
function* r327(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = read_orNull(h)!(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r328(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function* r329(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r330(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function* r331(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r332(h: Holder, a: (Fn | null)[], p?: Fn | null) { return h.orNull!(...pair); }
function* r333(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { return h.orNull!(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r334(h: Holder, a: (Fn | null)[], p?: Fn | null) { var r: number; r = h.orNull!(...pair); return r; }
function* r335(h: Holder, a: (Fn | null)[], p?: Fn | null) { try { var r: number; r = h.orNull!(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
const cases_absent: { label: string, h: Holder, a: (Fn | undefined)[], passes: boolean }[] = [
  { label: "function", h: { absent: inc, orUndefined: undefined, orNull: null }, a: [inc], passes: true },
  { label: "other", h: { absent: twice, orUndefined: undefined, orNull: null }, a: [twice], passes: true },
  { label: "proxy", h: { absent: proxied, orUndefined: undefined, orNull: null }, a: [proxied], passes: true },
  { label: "bound", h: { absent: bound, orUndefined: undefined, orNull: null }, a: [bound], passes: true },
  { label: "host", h: { absent: Math.abs, orUndefined: undefined, orNull: null }, a: [Math.abs], passes: true },
  { label: "absent", h: { orUndefined: undefined, orNull: null }, a: [], passes: false },
  { label: "undefined", h: { absent: undefined, orUndefined: undefined, orNull: null }, a: [undefined], passes: true },
  { label: "revoked", h: { absent: revoked, orUndefined: undefined, orNull: null }, a: [revoked], passes: true },
  { label: "function", h: { absent: inc, orUndefined: undefined, orNull: null }, a: [inc], passes: true },
];
const cases_orUndefined: { label: string, h: Holder, a: (Fn | undefined)[], passes: boolean }[] = [
  { label: "function", h: { orUndefined: inc, orNull: null }, a: [inc], passes: true },
  { label: "other", h: { orUndefined: twice, orNull: null }, a: [twice], passes: true },
  { label: "proxy", h: { orUndefined: proxied, orNull: null }, a: [proxied], passes: true },
  { label: "bound", h: { orUndefined: bound, orNull: null }, a: [bound], passes: true },
  { label: "host", h: { orUndefined: Math.abs, orNull: null }, a: [Math.abs], passes: true },
  { label: "undefined", h: { orUndefined: undefined, orNull: null }, a: [undefined], passes: true },
  { label: "revoked", h: { orUndefined: revoked, orNull: null }, a: [revoked], passes: true },
  { label: "function", h: { orUndefined: inc, orNull: null }, a: [inc], passes: true },
];
const cases_orNull: { label: string, h: Holder, a: (Fn | null)[], passes: boolean }[] = [
  { label: "function", h: { orNull: inc, orUndefined: undefined }, a: [inc], passes: true },
  { label: "other", h: { orNull: twice, orUndefined: undefined }, a: [twice], passes: true },
  { label: "proxy", h: { orNull: proxied, orUndefined: undefined }, a: [proxied], passes: true },
  { label: "bound", h: { orNull: bound, orUndefined: undefined }, a: [bound], passes: true },
  { label: "host", h: { orNull: Math.abs, orUndefined: undefined }, a: [Math.abs], passes: true },
  { label: "null", h: { orNull: null, orUndefined: undefined }, a: [null], passes: true },
  { label: "revoked", h: { orNull: revoked, orUndefined: undefined }, a: [revoked], passes: true },
  { label: "function", h: { orNull: inc, orUndefined: undefined }, a: [inc], passes: true },
];
function said(e: unknown): string { return e instanceof TypeError ? "TypeError" : "other " + String(e); }
function outcome(f: () => unknown): string { try { return String(f()); } catch (e) { return said(e); } }
async function main() {
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18, r19, r20, r21, r22, r23, r24, r25, r26, r27];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "absent, plain, " + names[i] + ":";
      for (const c of cases_absent) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.absent) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r28, r29, r30, r31, r32, r33, r34, r35, r36, r37, r38, r39, r40, r41, r42, r43, r44, r45, r46, r47, r48, r49, r50, r51, r52, r53, r54, r55];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "absent, closure, " + names[i] + ":";
      for (const c of cases_absent) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.absent) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r56, r57, r58, r59, r60, r61, r62, r63, r64, r65, r66, r67, r68, r69, r70, r71, r72, r73, r74, r75, r76, r77, r78, r79, r80, r81, r82, r83];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "absent, async, " + names[i] + ":";
      for (const c of cases_absent) {
        line += " " + c.label + "=" + await (c.passes ? row(c.h, c.a, c.h.absent) : row(c.h, c.a)).then(String, said);
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r84, r85, r86, r87, r88, r89, r90, r91, r92, r93, r94, r95, r96, r97, r98, r99, r100, r101, r102, r103, r104, r105, r106, r107, r108, r109, r110, r111];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "absent, generator, " + names[i] + ":";
      for (const c of cases_absent) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.absent) : row(c.h, c.a)).next().value; return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r112, r113, r114, r115, r116, r117, r118, r119, r120, r121, r122, r123, r124, r125, r126, r127, r128, r129, r130, r131, r132, r133, r134, r135, r136, r137, r138, r139];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orUndefined, plain, " + names[i] + ":";
      for (const c of cases_orUndefined) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.orUndefined) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r140, r141, r142, r143, r144, r145, r146, r147, r148, r149, r150, r151, r152, r153, r154, r155, r156, r157, r158, r159, r160, r161, r162, r163, r164, r165, r166, r167];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orUndefined, closure, " + names[i] + ":";
      for (const c of cases_orUndefined) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.orUndefined) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r168, r169, r170, r171, r172, r173, r174, r175, r176, r177, r178, r179, r180, r181, r182, r183, r184, r185, r186, r187, r188, r189, r190, r191, r192, r193, r194, r195];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orUndefined, async, " + names[i] + ":";
      for (const c of cases_orUndefined) {
        line += " " + c.label + "=" + await (c.passes ? row(c.h, c.a, c.h.orUndefined) : row(c.h, c.a)).then(String, said);
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r196, r197, r198, r199, r200, r201, r202, r203, r204, r205, r206, r207, r208, r209, r210, r211, r212, r213, r214, r215, r216, r217, r218, r219, r220, r221, r222, r223];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orUndefined, generator, " + names[i] + ":";
      for (const c of cases_orUndefined) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.orUndefined) : row(c.h, c.a)).next().value; return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r224, r225, r226, r227, r228, r229, r230, r231, r232, r233, r234, r235, r236, r237, r238, r239, r240, r241, r242, r243, r244, r245, r246, r247, r248, r249, r250, r251];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orNull, plain, " + names[i] + ":";
      for (const c of cases_orNull) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.orNull) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r252, r253, r254, r255, r256, r257, r258, r259, r260, r261, r262, r263, r264, r265, r266, r267, r268, r269, r270, r271, r272, r273, r274, r275, r276, r277, r278, r279];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orNull, closure, " + names[i] + ":";
      for (const c of cases_orNull) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.orNull) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r280, r281, r282, r283, r284, r285, r286, r287, r288, r289, r290, r291, r292, r293, r294, r295, r296, r297, r298, r299, r300, r301, r302, r303, r304, r305, r306, r307];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orNull, async, " + names[i] + ":";
      for (const c of cases_orNull) {
        line += " " + c.label + "=" + await (c.passes ? row(c.h, c.a, c.h.orNull) : row(c.h, c.a)).then(String, said);
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member with !, last", "member with !, last, in try", "member with !, not last", "member with !, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r308, r309, r310, r311, r312, r313, r314, r315, r316, r317, r318, r319, r320, r321, r322, r323, r324, r325, r326, r327, r328, r329, r330, r331, r332, r333, r334, r335];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "orNull, generator, " + names[i] + ":";
      for (const c of cases_orNull) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.orNull) : row(c.h, c.a)).next().value; return r; });
      }
      console.log(line);
    }
  }
}
main();
