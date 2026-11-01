// RUN: lower
// OPTIONS: builtin-modules

// `Intl.Segmenter` with grapheme granularity: the fast path that avoids ICU gives the same answers as ICU (the same program without type annotations).
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
const graphemes = new Intl.Segmenter;
const of = (...units) => String.fromCharCode(...units);
export function cuts(s) {
  let out = "";
  for (const { segment, index, input } of graphemes.segment(s))
    out += index + ":" + segment.length + (input === s ? "" : "?") + ",";
  return out;
}
export function around(s) {
  const segments = graphemes.segment(s);
  let out = "";
  for (let i = 0;i < s.length; i++) {
    const found = segments.containing(i);
    out += found.index + ":" + found.segment.length + ",";
  }
  return out;
}
function mixed(text, h) {
  for (let i = 0;i < text.length; i++)
    h = h * 31 + text.charCodeAt(i) | 0;
  return h;
}
const special = [0, 9, 10, 13, 32, 65, 127, 128, 133, 160, 169, 173, 174, 255, 256, 767, 768, 769, 879, 880, 1155, 1535, 1536, 1541, 1542, 2307, 2325, 2381, 3585, 3635, 4352, 4449, 4520, 8203, 8204, 8205, 8232, 8419, 9472, 10084, 12288, 44032, 55296, 55356, 55357, 56320, 56806, 56832, 57339, 65039, 65279, 65535];
{
  let h = 0;
  for (let a = 0;a < 128; a++)
    for (let b = 0;b < 128; b++) {
      const s = of(a, b);
      h = mixed(cuts(s) + around(s), h);
    }
  print("ASCII pairs " + h);
}
{
  let h = 0;
  for (const a of special)
    for (const b of special)
      for (const c of special) {
        const s = of(a, b, c);
        h = mixed(cuts(s) + "|" + around(s), h);
      }
  print("triples " + h);
}
{
  let h = 0;
  for (const a of special)
    for (const b of special) {
      const s = "x" + of(a) + "y" + of(b) + `z\r
` + of(a, b) + `
\r` + of(b);
      h = mixed(cuts(s) + "|" + around(s), h);
    }
  print("in texts " + h);
}
for (const s of ["", "a", "ab", `\r
`, `a\r
b`, `
\r`, `\r\r

`, "e\u0301", "ae\u0301b", "\u0301", "a\u0600b", "\u0600", "\uD83D\uDE00", "a\uD83D\uDE00b", "\uD83C\uDDE9\uD83C\uDDEA\uD83C\uDDEB\uD83C\uDDF7x", "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67", "\u2764\uFE0F", "1\uFE0F\u20E3", "\xA9\u200D\xA9", "\xA9\uFE0F", "\u1100\u1161\u11A8", "\uAC00\u11A8x", "\u0915\u094D\u0937", "\u0E01\u0E33", "\uD800", "a\uD800b", "\uDC00\uD800", "caf\xE9 \u2500\u2500 ok", "\u65E5\u672C\u8A9E abc", "a\u200Db", "\u200D", "x\xAD\u0301y"])
  print(show(s) + " " + cuts(s) + " | " + around(s));
{
  const narrow = `plain text, \xE9\xFF\xA9\r
next`;
  const wide = (`plain text, \xE9\xFF\xA9\r
next` + "\u2500").slice(0, -1);
  print(String(cuts(`plain text, \xE9\xFF\xA9\r
next`) === cuts(wide)) + String(around(`plain text, \xE9\xFF\xA9\r
next`) === around(wide)) + " " + cuts(cat("ab\r", `
cd`)) + " " + cuts(part("xxe\u0301xx", 1, 5)) + " " + around(cat("e", "\u0301")) + " " + cuts(part(`a\r
b`, 1, 2)) + cuts(part(`a\r
b`, 2, 4)));
}
{
  const segments = graphemes.segment(`ae\u0301\r
z`);
  print([-1, -0, 0, 0.9, 1, 1.5, 2, 3, 4, 5, 6, NaN, 1 / 0, -1 / 0, undefined, null, "2", "x", true, { valueOf() {
    return 3;
  } }].map((i) => {
    const f = segments.containing(i);
    return f ? f.index + ":" + show(f.segment) + Object.keys(f).join("") : "undefined";
  }).join(" "));
  print(attempt(() => segments.containing(Symbol.iterator)) + " " + attempt(() => segments.containing(1n)));
}
{
  const segments = graphemes.segment(`ab\u0301c\uD83D\uDE00d\r
e`);
  const a = segments[Symbol.iterator](), b = segments[Symbol.iterator]();
  let out = "";
  for (let i = 0;i < 9; i++) {
    const x = a.next();
    out += x.done ? "." : x.value.index;
    if (i & 1) {
      const y = b.next();
      out += y.done ? "!" : "(" + y.value.segment.length + ")";
    }
    out += segments.containing(i)?.index ?? "-";
    out += " ";
  }
  print(out + JSON.stringify(a.next()) + JSON.stringify(a.next()) + show([...b].map((x) => x.index).join()));
}
{
  const it = graphemes.segment("abc")[Symbol.iterator]();
  print(String(it[Symbol.iterator]() === it) + Object.prototype.toString.call(it) + JSON.stringify(it.next()));
}
{
  let n = 0;
  for (let i = 0;i < 3000; i++) {
    const s = "line " + i + (i % 7 ? "" : " \u2500e\u0301") + (i % 11 ? "" : `\r
`);
    n += [...graphemes.segment(s)].length + graphemes.segment(s).containing(i % s.length).index;
  }
  print(String(n));
}
{
  const words = new Intl.Segmenter("en", { granularity: "word" }), sentences = new Intl.Segmenter("en", { granularity: "sentence" });
  const s = `Hello, wide world. It's 3.5 \u2500 ok?  Yes\r
no`;
  print([...words.segment(`Hello, wide world. It's 3.5 \u2500 ok?  Yes\r
no`)].map((x) => x.index + (x.isWordLike ? "w" : "-")).join() + " " + [...sentences.segment(`Hello, wide world. It's 3.5 \u2500 ok?  Yes\r
no`)].map((x) => x.index).join() + " " + JSON.stringify(words.segment(`Hello, wide world. It's 3.5 \u2500 ok?  Yes\r
no`).containing(8)) + " " + sentences.segment(`Hello, wide world. It's 3.5 \u2500 ok?  Yes\r
no`).containing(20).index + " " + [...words.segment("")].length + String(words.segment("").containing(0)));
}
print(["th", "ja", "hi", "ar", "ko", "sv"].map((l) => {
  const g = new Intl.Segmenter(l);
  return [...g.segment(`ab\r
\u0E01\u0E33e\u0301\u0915\u094D\u0937z`)].map((x) => x.index).join("");
}).join());
globalThis.kept = [cuts, around];
console.log("number");

// GENERATED: cuts cat3 of
// CHECK-LABEL: function {{*}}name="cuts"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="graphemes"
// CHECK-NEXT: v5 = PropGet v4 key="segment"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v0 calleeKey="segment" calleeName="graphemes.segment"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = IteratorOpen v8
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = IteratorResume v9
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Branch v13 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b15():
// CHECK-NEXT: v16 = TypeTest v14 testedType=undefined|null
// CHECK-NEXT: Branch v16 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v17) handler=b15():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() frequency=Unlikely handler=b15():
// CHECK-NEXT: v18 = NewRuntimeError runtimeError=NotDestructurable name="segment"
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b8(v19) handler=b15():
// CHECK-NEXT: v20 = PropGet v19 key="segment"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v19 key="index"
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v19 key="input"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v26 = String string=":"
// CHECK-NEXT: v27 = Add v23, v26
// CHECK-NEXT: v28 = PropGet v21 key="length"
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v30 = Add v27, v29
// CHECK-NEXT: v31 = StrictEq v25, v0
// CHECK-NEXT: Branch v31 -> taken b9(| 0, 1), notTaken b11(| 0, 1)
// CHECK-NEXT: b9(v32, v33) handler=b15():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b15():
// CHECK-NEXT: v34 = String string=""
// CHECK-NEXT: Jump -> next b13(v34)
// CHECK-NEXT: b11(v35, v36) handler=b15():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b15():
// CHECK-NEXT: v37 = String string="?"
// CHECK-NEXT: Jump -> next b13(v37)
// CHECK-NEXT: b13(v38) handler=b15():
// CHECK-NEXT: v39 = Add v30, v38
// CHECK-NEXT: v40 = String string=","
// CHECK-NEXT: v41 = Add v39, v40
// CHECK-NEXT: v42 = Add v10, v41
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14() handler=b15():
// CHECK-NEXT: Jump -> next b2(v43)
// CHECK-NEXT: b15() role=IterationCleanup subject=v9:
// CHECK-NEXT: v44 = CatchException
// CHECK-NEXT: IteratorClose v9 completion=Throw
// CHECK-NEXT: Rethrow v44
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="cat3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=LeftOutOfExecutable name="cat3"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="of"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Builtin builtin=StringFromCharCode
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v0
// CHECK-NEXT: v5 = CallList v2, v1, v3 calleeName="String.fromCharCode"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
