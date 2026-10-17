// Values that are no functions (and some unusual ones that are) are called in every way, in untyped code: a TypeError wherever the call stands, also where it is the last thing its function does.
const inc = x => x + 1;
const twice = x => x * 2;
const proxied = new Proxy(inc, {});
const bound = inc.bind(null);
const revocable = Proxy.revocable(inc, {}); revocable.revoke(); const revoked = revocable.proxy;
const pair = [1, 2];
function read_m(h) { return h.m; }
function r0(h, a, p) { const v = h.m; return v(1); }
function r1(h, a, p) { try { const v = h.m; return v(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r2(h, a, p) { const v = h.m; var r; r = v(1); return r; }
function r3(h, a, p) { try { const v = h.m; var r; r = v(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r4(h, a, p) { return h.m(1); }
function r5(h, a, p) { try { return h.m(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r6(h, a, p) { var r; r = h.m(1); return r; }
function r7(h, a, p) { try { var r; r = h.m(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r8(h, a, p) { return a[0](1); }
function r9(h, a, p) { try { return a[0](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r10(h, a, p) { var r; r = a[0](1); return r; }
function r11(h, a, p) { try { var r; r = a[0](1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r12(h, a, p) { return p(1); }
function r13(h, a, p) { try { return p(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r14(h, a, p) { var r; r = p(1); return r; }
function r15(h, a, p) { try { var r; r = p(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r16(h, a, p) { return read_m(h)(1); }
function r17(h, a, p) { try { return read_m(h)(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r18(h, a, p) { var r; r = read_m(h)(1); return r; }
function r19(h, a, p) { try { var r; r = read_m(h)(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r20(h, a, p) { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function r21(h, a, p) { try { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r22(h, a, p) { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function r23(h, a, p) { try { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r24(h, a, p) { return h.m(...pair); }
function r25(h, a, p) { try { return h.m(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r26(h, a, p) { var r; r = h.m(...pair); return r; }
function r27(h, a, p) { try { var r; r = h.m(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function r28(h, a, p) { const inner = () => { const v = h.m; return v(1); }; return inner(); }
function r29(h, a, p) { const inner = () => { try { const v = h.m; return v(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r30(h, a, p) { const inner = () => { const v = h.m; var r; r = v(1); return r; }; return inner(); }
function r31(h, a, p) { const inner = () => { try { const v = h.m; var r; r = v(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r32(h, a, p) { const inner = () => { return h.m(1); }; return inner(); }
function r33(h, a, p) { const inner = () => { try { return h.m(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r34(h, a, p) { const inner = () => { var r; r = h.m(1); return r; }; return inner(); }
function r35(h, a, p) { const inner = () => { try { var r; r = h.m(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r36(h, a, p) { const inner = () => { return a[0](1); }; return inner(); }
function r37(h, a, p) { const inner = () => { try { return a[0](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r38(h, a, p) { const inner = () => { var r; r = a[0](1); return r; }; return inner(); }
function r39(h, a, p) { const inner = () => { try { var r; r = a[0](1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r40(h, a, p) { const inner = () => { return p(1); }; return inner(); }
function r41(h, a, p) { const inner = () => { try { return p(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r42(h, a, p) { const inner = () => { var r; r = p(1); return r; }; return inner(); }
function r43(h, a, p) { const inner = () => { try { var r; r = p(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r44(h, a, p) { const inner = () => { return read_m(h)(1); }; return inner(); }
function r45(h, a, p) { const inner = () => { try { return read_m(h)(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r46(h, a, p) { const inner = () => { var r; r = read_m(h)(1); return r; }; return inner(); }
function r47(h, a, p) { const inner = () => { try { var r; r = read_m(h)(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r48(h, a, p) { const inner = () => { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); }; return inner(); }
function r49(h, a, p) { const inner = () => { try { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r50(h, a, p) { const inner = () => { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }; return inner(); }
function r51(h, a, p) { const inner = () => { try { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r52(h, a, p) { const inner = () => { return h.m(...pair); }; return inner(); }
function r53(h, a, p) { const inner = () => { try { return h.m(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
function r54(h, a, p) { const inner = () => { var r; r = h.m(...pair); return r; }; return inner(); }
function r55(h, a, p) { const inner = () => { try { var r; r = h.m(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }; return inner(); }
async function r56(h, a, p) { const v = h.m; return v(1); }
async function r57(h, a, p) { try { const v = h.m; return v(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r58(h, a, p) { const v = h.m; var r; r = v(1); return r; }
async function r59(h, a, p) { try { const v = h.m; var r; r = v(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r60(h, a, p) { return h.m(1); }
async function r61(h, a, p) { try { return h.m(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r62(h, a, p) { var r; r = h.m(1); return r; }
async function r63(h, a, p) { try { var r; r = h.m(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r64(h, a, p) { return a[0](1); }
async function r65(h, a, p) { try { return a[0](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r66(h, a, p) { var r; r = a[0](1); return r; }
async function r67(h, a, p) { try { var r; r = a[0](1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r68(h, a, p) { return p(1); }
async function r69(h, a, p) { try { return p(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r70(h, a, p) { var r; r = p(1); return r; }
async function r71(h, a, p) { try { var r; r = p(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r72(h, a, p) { return read_m(h)(1); }
async function r73(h, a, p) { try { return read_m(h)(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r74(h, a, p) { var r; r = read_m(h)(1); return r; }
async function r75(h, a, p) { try { var r; r = read_m(h)(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r76(h, a, p) { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); }
async function r77(h, a, p) { try { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r78(h, a, p) { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
async function r79(h, a, p) { try { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r80(h, a, p) { return h.m(...pair); }
async function r81(h, a, p) { try { return h.m(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
async function r82(h, a, p) { var r; r = h.m(...pair); return r; }
async function r83(h, a, p) { try { var r; r = h.m(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r84(h, a, p) { const v = h.m; return v(1); }
function* r85(h, a, p) { try { const v = h.m; return v(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r86(h, a, p) { const v = h.m; var r; r = v(1); return r; }
function* r87(h, a, p) { try { const v = h.m; var r; r = v(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r88(h, a, p) { return h.m(1); }
function* r89(h, a, p) { try { return h.m(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r90(h, a, p) { var r; r = h.m(1); return r; }
function* r91(h, a, p) { try { var r; r = h.m(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r92(h, a, p) { return a[0](1); }
function* r93(h, a, p) { try { return a[0](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r94(h, a, p) { var r; r = a[0](1); return r; }
function* r95(h, a, p) { try { var r; r = a[0](1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r96(h, a, p) { return p(1); }
function* r97(h, a, p) { try { return p(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r98(h, a, p) { var r; r = p(1); return r; }
function* r99(h, a, p) { try { var r; r = p(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r100(h, a, p) { return read_m(h)(1); }
function* r101(h, a, p) { try { return read_m(h)(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r102(h, a, p) { var r; r = read_m(h)(1); return r; }
function* r103(h, a, p) { try { var r; r = read_m(h)(1); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r104(h, a, p) { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function* r105(h, a, p) { try { return h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r106(h, a, p) { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; }
function* r107(h, a, p) { try { var r; r = h.m(1, 2, 3, 4, 5, 6, 7, 8, 9); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r108(h, a, p) { return h.m(...pair); }
function* r109(h, a, p) { try { return h.m(...pair); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function* r110(h, a, p) { var r; r = h.m(...pair); return r; }
function* r111(h, a, p) { try { var r; r = h.m(...pair); return r; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
const cases_m = [
  { label: "function", h: { m: inc }, a: [inc], passes: true },
  { label: "other", h: { m: twice }, a: [twice], passes: true },
  { label: "proxy", h: { m: proxied }, a: [proxied], passes: true },
  { label: "bound", h: { m: bound }, a: [bound], passes: true },
  { label: "host", h: { m: Math.abs }, a: [Math.abs], passes: true },
  { label: "absent", h: { }, a: [], passes: false },
  { label: "undefined", h: { m: undefined }, a: [undefined], passes: true },
  { label: "null", h: { m: null }, a: [null], passes: true },
  { label: "number", h: { m: 5 }, a: [5], passes: true },
  { label: "string", h: { m: "text" }, a: ["text"], passes: true },
  { label: "object", h: { m: {} }, a: [{}], passes: true },
  { label: "array", h: { m: [] }, a: [[]], passes: true },
  { label: "proxy-of-object", h: { m: new Proxy({}, {}) }, a: [new Proxy({}, {})], passes: true },
  { label: "class", h: { m: class K { } }, a: [class K { }], passes: true },
  { label: "symbol", h: { m: Symbol() }, a: [Symbol()], passes: true },
  { label: "boolean", h: { m: true }, a: [true], passes: true },
  { label: "bigint", h: { m: 10n }, a: [10n], passes: true },
  { label: "revoked", h: { m: revoked }, a: [revoked], passes: true },
  { label: "function", h: { m: inc }, a: [inc], passes: true },
];
function said(e) { return e instanceof TypeError ? "TypeError" : "other " + String(e); }
function outcome(f) { try { return String(f()); } catch (e) { return said(e); } }
async function main() {
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member, last", "member, last, in try", "member, not last", "member, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18, r19, r20, r21, r22, r23, r24, r25, r26, r27];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "m, plain, " + names[i] + ":";
      for (const c of cases_m) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.m) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member, last", "member, last, in try", "member, not last", "member, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r28, r29, r30, r31, r32, r33, r34, r35, r36, r37, r38, r39, r40, r41, r42, r43, r44, r45, r46, r47, r48, r49, r50, r51, r52, r53, r54, r55];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "m, closure, " + names[i] + ":";
      for (const c of cases_m) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.m) : row(c.h, c.a)); return r; });
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member, last", "member, last, in try", "member, not last", "member, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r56, r57, r58, r59, r60, r61, r62, r63, r64, r65, r66, r67, r68, r69, r70, r71, r72, r73, r74, r75, r76, r77, r78, r79, r80, r81, r82, r83];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "m, async, " + names[i] + ":";
      for (const c of cases_m) {
        line += " " + c.label + "=" + await (c.passes ? row(c.h, c.a, c.h.m) : row(c.h, c.a)).then(String, said);
      }
      console.log(line);
    }
  }
  {
    const names = ["variable, last", "variable, last, in try", "variable, not last", "variable, not last, in try", "member, last", "member, last, in try", "member, not last", "member, not last, in try", "element, last", "element, last, in try", "element, not last", "element, not last, in try", "parameter, last", "parameter, last, in try", "parameter, not last", "parameter, not last, in try", "result, last", "result, last, in try", "result, not last", "result, not last, in try", "nine arguments, last", "nine arguments, last, in try", "nine arguments, not last", "nine arguments, not last, in try", "spread, last", "spread, last, in try", "spread, not last", "spread, not last, in try"];
    const rows = [r84, r85, r86, r87, r88, r89, r90, r91, r92, r93, r94, r95, r96, r97, r98, r99, r100, r101, r102, r103, r104, r105, r106, r107, r108, r109, r110, r111];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let line = "m, generator, " + names[i] + ":";
      for (const c of cases_m) {
        line += " " + c.label + "=" + outcome(() => { var r; r = (c.passes ? row(c.h, c.a, c.h.m) : row(c.h, c.a)).next().value; return r; });
      }
      console.log(line);
    }
  }
}
main();
