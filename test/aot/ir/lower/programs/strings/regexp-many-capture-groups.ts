// RUN: lower
// OPTIONS: builtin-modules

// Regular expressions with a dozen and more capture groups: what is undefined after a match, after backtracking out of a group and after another iteration of a loop.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const narrow: string[] = ["", "abcdefghijk", "abcdefghijkl", "abcdefghijklm", "abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz", "a", "z", "a1b2c3d4e5f6g7h8", "abcxabx", "abc-ab-", "abc-", "ab-c-", "abce", "aabcdebe", "abcabcx", "abcdefghijklx", "abcdefghijkl5", "abc!", "xyz!", "xy!abc!", "abcxq", "ABCDEFGHIJKLM", "abcdefghijklla", "abcdefghijkllb"];
const wide: string[] = ["\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1", "abcdef\u4e2d\u4e2d\u4e2d\u4e2d\u4e2d\u4e2d", "\ud835\udc00abcdefghijk", "abcdefghijk\ud835\udc00"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const subject of narrow.concat(narrow.map((s: string): string => s + "\u0100"), wide)) {
        r.lastIndex = 0;
        const m = subject.match(r);
        parts.push(m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + m.map((c: string | undefined): string => c === undefined ? "~" : c === "" ? "0" : escape(c)).join(","));
    }
    console.log(r.source.length, r.flags, parts.join(" "));
}
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?/);
show(/^([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?$/);
show(/(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(z)/);
show(/(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?x)+/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?-)*$/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?-){2}/);
show(/(?:(a)|([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?e)+/);
show(/(([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?)*?x/);
show(/(?=([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z]))\1/);
show(/(?!([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])x)[a-z]/);
show(/(?<=([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z]))[0-9]/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?|([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?)!/);
show(/^(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?x|.)*$/);
show(/(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)/s);
show(/(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)/u);
show(/(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})/u);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/g);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/y);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/i);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])\12\1/);

// GENERATED: escape
// CHECK-LABEL: function {{*}}name="escape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5: undefined|null|string, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b7()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = PropGet v0 key="charCodeAt"
// CHECK-NEXT: v11 = Call v10, v0, v6 calleeKey="charCodeAt" calleeName="s.charCodeAt"
// CHECK-NEXT: v12 = Convert v11 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Integer integer=32
// CHECK-NEXT: v14 = GreaterEq v12, v13
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b5()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Integer integer=127
// CHECK-NEXT: v16 = Less v12, v15
// CHECK-NEXT: Branch v16 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = ElemGet v0, v6
// CHECK-NEXT: Jump -> next b6(v17)
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = String string="\\u"
// CHECK-NEXT: v19 = PropGet v12 key="toString"
// CHECK-NEXT: v20 = Integer integer=16
// CHECK-NEXT: v21 = Call v19, v12, v20 calleeKey="toString" calleeName="c.toString"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = PropGet v22 key="padStart"
// CHECK-NEXT: v24 = Integer integer=4
// CHECK-NEXT: v25 = String string="0"
// CHECK-NEXT: v26 = Call v23, v22, v24, v25 calleeKey="padStart" calleeName="padStart"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v28 = Add v18, v27
// CHECK-NEXT: Jump -> next b6(v28)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: v30 = Add v5, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v32 = Increment v6
// CHECK-NEXT: v33 = Convert v32 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v31, v33)
// CHECK-NEXT: b7():
// CHECK-NEXT: v34 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
