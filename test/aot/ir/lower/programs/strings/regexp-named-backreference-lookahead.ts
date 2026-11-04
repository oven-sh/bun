// RUN: lower
// OPTIONS: builtin-modules

// A lookahead that captures under a name, followed by a reference to that name: the way atomic groups and possessive quantifiers are written in JavaScript. Beside it, named references that must really compare.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const subjects: string[] = ["", "xy", "xay", "xaay", "xaaay", "xaaa", "xaab", "xaaby", "xaaaa", "XAAY", "xAay", "xaaY", "xabc", "xabay", "xbaby", "xaayx", "xaayy", "xaaaay", "xayaay", "xaayaa", "xab", "xaabb", "\"abc\"", "'a\"", "\"a'b\"", "  word", "word", " 9", "x\u03b1\u03b2;", "x\u03b1\u03b2\u03b3", "x\ud835\udc00\ud835\udc00y", "x\ud835\udc00y", "x\ud835y", "yz", "ybbz", "xaaz", "aa", "bb", "ab", "aaxaa", "axa", "foo bar", "foo  bar baz", "xaaya", "xaaa\u0100", "zzxaay"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const s of subjects) {
        for (const subject of [s, s + "\u4e2d"]) {
            r.lastIndex = 0;
            const m = subject.match(r);
            parts.push(m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + escape(c) + ">").join(""));
        }
    }
    console.log(String(r), parts.join(" "));
}
show(/x(?=(?<n>a+))\k<n>y/);
show(/x(?:(?=(?<n>a+))\k<n>)y/);
show(/x(?:(?=(?<n>a+))\k<n>)a/);
show(/x(?:(?=(?<n>a*))\k<n>)y/v);
show(/x(?:(?=(?<n>\p{L}+))\k<n>);/v);
show(/x(?:(?=(?<n>\p{L}+))\k<n>)\p{L}/v);
show(/(?:(?=(?<s>\s*))\k<s>)(?:(?=(?<w>\p{L}+))\k<w>)\b/v);
show(/x(?:(?=(?<n>(?:a|b)+))\k<n>)y/v);
show(/x(?:(?=(?<n>(?:a|ab)))\k<n>)c/);
show(/x(?:(?=(?<n>a+))\k<n>)+y/v);
show(/x(?:(?=(?<n>a+))\k<n>)?y/v);
show(/x(?:(?=(?<n>a+))\k<n>)*?y/v);
show(/x(?:(?=(?<n>a+))\k<n>)y/iv);
show(/x(?:(?=(?<n>[a-z]+))\k<n>)Y/i);
show(/x(?:(?=(?<n>\p{Lu}+))\k<n>)y/iu);
show(/(?<q>x)(?:(?=(?<n>a+))\k<n>)y\k<q>/v);
show(/x(?<n>a+)\k<n>y/v);
show(/x(?<n>a+)y\k<n>/);
show(/(?<q>["\x27]).*?\k<q>/);
show(/(?<q>["\x27])(?:(?=(?<n>[^"\x27]*))\k<n>)\k<q>/);
show(/x(?=(?<n>a+))b?\k<n>y/);
show(/x(?=(?<n>a+)b)\k<n>b/);
show(/x(?=(?<n>a+))\k<n>\k<n>/);
show(/x(?!(?<n>a+)b)\k<n>a/);
show(/x(?=(?<n>a+))(?:\k<n>)y/);
show(/x(?=(?<n>a+))\k<n>{2}/);
show(/x(?=(?<n>a+))\k<n>?y/);
show(/\k<n>x(?=(?<n>a+))\k<n>y/);
show(/(?:x(?=(?<n>a+))\k<n>|y(?=(?<n>b+))\k<n>)z/v);
show(/(?:(?<n>a)|(?<n>b))\k<n>/v);
show(/(?<=(?<n>a+))x\k<n>/);
show(/x(?:(?=(?<n>(?<m>a)+))\k<n>)\k<m>/);
show(/x(?:(?=(?<n>\u{1D400}+))\k<n>)y/v);
show(/x(?:(?=(?<n>.+?))\k<n>)y/sv);
show(/^(?:(?=(?<n>\w+))\k<n>)(?:(?=(?<m>\s+))\k<m>)(?:(?=(?<o>\w+))\k<o>)$/v);
show(/x(?:(?=(?<n>a+))\k<n>)y/g);
show(/x(?:(?=(?<n>a+))\k<n>)y/y);

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
