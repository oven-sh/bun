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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: undefined|null|string, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v0 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = Less v8, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b14(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = PropGet v0 key="charCodeAt"
// CHECK-NEXT: v14 = Convert v12 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v13, v0, v14 calleeKey="charCodeAt" calleeName="s.charCodeAt"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Integer integer=32
// CHECK-NEXT: v18 = GreaterEq v16, v17
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b10(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v20 = Integer integer=127
// CHECK-NEXT: v21 = Less v19, v20
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v23 = ElemGet v0, v14
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b12(v24)
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Jump -> next b11(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: Jump -> next b11(v26)
// CHECK-NEXT: b11(v27: number):
// CHECK-NEXT: v28 = String string="\\u"
// CHECK-NEXT: v29 = PropGet v27 key="toString"
// CHECK-NEXT: v30 = Integer integer=16
// CHECK-NEXT: v31 = Call v29, v27, v30 calleeKey="toString" calleeName="c.toString"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v33 = PropGet v32 key="padStart"
// CHECK-NEXT: v34 = Integer integer=4
// CHECK-NEXT: v35 = String string="0"
// CHECK-NEXT: v36 = Call v33, v32, v34, v35 calleeKey="padStart" calleeName="padStart"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v38 = Add v28, v37
// CHECK-NEXT: Jump -> next b12(v38)
// CHECK-NEXT: b12(v39):
// CHECK-NEXT: v40 = Add v5, v39
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v42 = Increment v14
// CHECK-NEXT: v43 = Convert v42 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v41, v43)
// CHECK-NEXT: b14(v44):
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v45 = Convert v5 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v45
// CHECK-NEXT: }
