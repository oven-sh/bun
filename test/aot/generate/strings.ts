// The programs of strings that are mostly a loop written out: thousands of fields, variables or functions that differ in a number. And those that are another program without its types.
import { family, programsOf, text, untypedTwins } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `regexp-futile-backtracking-stress-1.ts
regexp-futile-backtracking-stress-2.ts
regexp-futile-backtracking.ts`,
      () => `// Regular expressions with loops and groups that never need to be backtracked into (what follows cannot start with anything they give back), next to look-alikes that do need it.
export { };
function show(r: RegExp, subjects: string[]): void {
    const parts: string[] = [];
    for (const s of subjects) {
        for (const subject of [s, s + "\\u0100"]) {
            r.lastIndex = 0;
            const m = subject.match(r);
            parts.push(m === null ? "-" : m.index + ":" + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + c + ">").join(""));
        }
    }
    console.log(String(r), parts.join(" "));
}
const lists = ["1,2,3;", "1,2,3", "1,2,;", "12,345;x", ";", "1;", ",1;", "1,,2;", "x 1,2;3,4;"];
show(/\\d+(?:,\\d+)*;/, lists);
show(/\\d+(?:,\\d+)+;/, lists);
show(/(\\d+)(?:,(\\d+))*;/, lists);
show(/(\\d+(?:,\\d+)*);/, lists);
show(/^(?:\\d+(?:,\\d+)*;)*$/, lists);
show(/(?:\\d+(?:\\.\\d+)*;)*$/, ["1.2;3;", "1.2;3", "1..2;", "1.2.3;4.5;x"]);
show(/\\d+(?:,\\d+)*,/, lists);
show(/\\d+(?:,\\d+)*\\d/, lists);
show(/\\d+(?:,\\d+)*\\b/, lists);
show(/\\d+(?:,\\d+)*(?=;)/, lists);
show(/\\d+(?:,\\d+)*(?!;)/, lists);
const letters = ["aaab", "aab", "ab", "b", "aaa", "abab", "ababa", "abac", "abc", "aabc", "cab", "abcabc", "ba", ""];
show(/a*ab/, letters);
show(/a*b/, letters);
show(/a+b/, letters);
show(/a*[ab]b/, letters);
show(/a*[^a]/, letters);
show(/a*(?:b|)c/, letters);
show(/a*(?:a|b)/, letters);
show(/a*(?:b|c)/, letters);
show(/a?b/, letters);
show(/a?ab/, letters);
show(/a{0,2}b/, letters);
show(/a{0,2}ab/, letters);
show(/a{1,2}a?b/, letters);
show(/(?:a|ab)*c/, letters);
show(/(?:ab|a)*c/, letters);
show(/(?:a|b)+c/, letters);
show(/(?:a|b)*c/, letters);
show(/(?:a|b)*a/, letters);
show(/(?:ab)*a/, letters);
show(/(?:ab)*c/, letters);
show(/(?:ab)+c/, letters);
show(/(?:a+b)*a+c/, letters);
show(/(?:a+b)*c/, letters);
show(/(?:a*b)*c/, letters);
show(/(?:a*)*b/, letters);
show(/(?:a|)*b/, letters);
show(/(?:a?b?)*c/, letters);
show(/(?:a|b)*?c/, letters);
show(/a*?b/, letters);
show(/(?:(?:a|b)+c|ab)/, letters);
show(/(?:(a)|(b))c|ab/, letters);
show(/(?:(?:(a)|(b))c|ab)/, letters);
show(/((?:a|b)+)c|ab/, letters);
show(/(a|b)c|ab/, letters);
show(/(?:(a|b)c|ab)b?/, letters);
show(/(a*)b\\1/, ["aabaa", "aaba", "b", "ab"]);
show(/(a*)\\1b/, ["aab", "aaab", "aaaab", "b"]);
show(/(?<=a*)b/, letters);
show(/(?<=(?:a|b)+)c/, letters);
show(/(?=a*b)a/, letters);
show(/(?!a*b)a/, letters);
show(/(?=(?:a|b)*c)a/, letters);
const words = ["ab-", "ab-cd", "abc1", "abc", "a_b c", "-", "x-1-", "foo.bar", "foo.", "9a"];
show(/[a-z]+\\b/, words);
show(/[a-z0-9-]+\\b/, words);
show(/[a-z-]+\\B/, words);
show(/\\w+(?=\\d)/, words);
show(/\\w+(?!\\d)/, words);
show(/\\w+\\./, words);
show(/\\w+-/, words);
show(/\\w+\\W/, words);
show(/\\w+\\w/, words);
show(/[a-z]+[0-9]/, words);
show(/[a-z]+[a-c]/, words);
show(/[^-]+-/, words);
show(/[^-]*[^a]/, words);
show(/.*-/, words);
show(/.*$/, words);
show(/[a-z]*$/, words);
const lines = ["a  \\n b", "a\\n", "  \\n\\n  ", "x \\r\\n y", "a\\u2028b", "ab", "\\n", " "];
show(/\\s*$/m, lines);
show(/[ ]*$/m, lines);
show(/[^\\n]*$/m, lines);
show(/.*$/m, lines);
show(/.*\\n/, lines);
show(/.*\\n/s, lines);
show(/\\s*$/, lines);
show(/\\S*\\s*$/, lines);
show(/[ ]*^/m, lines);
show(/\\s*^b/m, lines);
const quoted = ['"a\\\\"b"', '"abc', '"a\\\\"', '""', '"a"b"', 'x"\\\\\\\\"y', '"\\\\', '"a\\\\\\\\"b"'];
show(/"(?:[^"\\\\]|\\\\.)*"/, quoted);
show(/"([^"\\\\]|\\\\.)*"/, quoted);
show(/"(?:[^"\\\\]+|\\\\.)*"/, quoted);
show(/"(?:\\\\.|[^"\\\\])*"/, quoted);
show(/"(?:[^"]|\\\\.)*"/, quoted);
show(/"[^"]*"/, quoted);
show(/"[^"]*"?/, quoted);
const names = ["foo", "bar", "foobar", "barfoo", "case", "catch", "class", "cat", "in", "instanceof", "int", "Z", "+12", "-1", "do", "double"];
show(/^(foo|bar)$/, names);
show(/^(?:foo|bar)$/, names);
show(/(?:foo|foobar)$/, names);
show(/(?:foobar|foo)$/, names);
show(/(?:case|catch|class)\\b/, names);
show(/\\b(?:in|instanceof)\\b/, names);
show(/\\b(?:instanceof|in)\\b/, names);
show(/\\b(?:do|double)\\b/, names);
show(/(Z|[+-]\\d\\d)$/, names);
show(/(?:c[a-l]|ca)t/, names);
show(/(?:c\\w|ba)[rt]/, names);
show(/(?:fo+|ba+)r/, names);
show(/(?:fo*|f)oo/, names);
show(/(?:[a-c]a|[d-f]o)[a-z]$/, names);
const cased = ["kK\\u212a", "sS\\u017f", "KELVIN\\u212a", "ss\\u017fx", "\\u212a", "k", "straSSe"];
show(/k+\\u212a/iu, cased);
show(/k+\\u212a/i, cased);
show(/s*\\u017f/iu, cased);
show(/s*\\u017f/i, cased);
show(/[a-z]+\\u212a/iu, cased);
show(/[a-z]+\\u212a/i, cased);
show(/[a-z]+K/i, cased);
show(/[a-j]+K/i, cased);
show(/s+x/i, cased);
const wide = ["\\u{1F600}\\u{1F601}x", "\\u{1F600}\\ud83d", "\\ud83d\\ude00\\ude00", "a\\u{1F600}", "\\u00e9\\u00e8z", "\\u4e2d\\u6587;", "\\ud83d"];
show(/[\\u{1F600}-\\u{1F64F}]+x/u, wide);
show(/(?:\\u{1F600})+\\ud83d/u, wide);
show(/\\u{1F600}*\\ud83d/u, wide);
show(/[\\ud83d]+\\ude00/, wide);
show(/.+\\ude00/, wide);
show(/.+\\ude00/u, wide);
show(/\\p{L}+;/u, wide);
show(/\\p{L}+\\p{Lu}/u, wide);
show(/\\P{L}+x/u, wide);
show(/[^x]+x/u, wide);
show(/(?:\\p{L}|\\p{N})+;/u, wide);
const prefixes = ["abcd", "abc", "ab", "a", "abd", "abbcd", "foo", "foobar", "foob", "foobarbaz", "in", "ins", "instanceof", "instanceofx", "in x", "import", "if", "i", "elseif", "else", "else if", "x.y", "x.", "xy"];
show(/(a|ab)(c|bcd)(d*)/, prefixes);
show(/(?:a|ab)(?:c|bcd)/, prefixes);
show(/(?:a|ab)c/, prefixes);
show(/(?:a|ab)d/, prefixes);
show(/(?:a|ab|abc)d/, prefixes);
show(/(?:a|ab|abc)$/, prefixes);
show(/(?:a|ab|abc)\\b/, prefixes);
show(/(?:abc|ab|a)\\b/, prefixes);
show(/(a|ab|abc)\\b/, prefixes);
show(/(?:foo|foobar|foobarbaz)\\b/, prefixes);
show(/(?:foo|foobar|foobarbaz)(?!b)/, prefixes);
show(/(?:foo|foobar)b?/, prefixes);
show(/(?:foo|foobar)[^b]/, prefixes);
show(/(?:foo|foobar)[a-c]/, prefixes);
show(/\\b(?:if|in|import|instanceof|i)\\b/, prefixes);
show(/\\b(?:if|in|import|instanceof|i)\\B/, prefixes);
show(/\\b(?:else|elseif|else if)\\b/, prefixes);
show(/\\b(?:else|elseif)(?: if)?\\b/, prefixes);
show(/^(?:|a|ab)$/, prefixes);
show(/^a(?:|b|bc)d?$/, prefixes);
show(/^a(?:|b|bc)\\b/, prefixes);
show(/x(?:|\\.)y?$/, prefixes);
show(/(?:[ab]c|[bc]c|ab)c?d/, prefixes);
show(/(?:a[bc]|ab)[cd]/, prefixes);
show(/(?:(?:a|ab)+)c/, prefixes);
show(/(?:a|ab)+c/, prefixes);
show(/(?:a|ab)*d/, prefixes);
show(/(?:b|bb)*c/, prefixes);
show(/(?:in|instanceof|import|if|else|elseif|for|foreach|do|double|def|default|delete|new|next|null|nil|var|void|while|with|yield|try|true|this|throw|typeof|then)\\b/, prefixes.concat(["foreach", "for", "forx", "default", "def", "nulls", "typeof", "then", "the"]));
show(/\\b(in|instanceof|import|if|else|elseif|for|foreach|do|double|def|default|delete|new|next|null|nil|var|void|while|with|yield|try|true|this|throw|typeof|then)\\b/, prefixes.concat(["foreach", "for", "forx", "default", "def", "nulls", "typeof", "then", "the"]));
show(/\\d+(?:,\\d+)*;/y, lists);
show(/\\d+(?:,\\d+)*;/g, lists);
console.log("1,2;3,4,5;x6;".replace(/\\d+(?:,\\d+)*;/g, "[$&]"), "a,b , c".split(/\\s*,\\s*/).join("|"), "  x  ".replace(/^\\s+|\\s+$/g, ""), [..."k1=v1;k2=v2".matchAll(/(\\w+)=(\\w+)(?:;|$)/g)].map((m: RegExpMatchArray): string => m[1] + m[2]).join());
`,
    ),
    ...untypedTwins("strings", "js", [
      "access",
      "anchored-searches",
      "array-entries",
      "atomic-group-idiom",
      "buffer-byte-length-every-length",
      "build-time-strings",
      "char-codes-at-numbers-of-every-kind",
      "characters-outside-loops",
      "closures-called-via-table",
      "comparisons-with-string-literals",
      "computed-key-stores-outside-loops",
      "fast-path-rejected-inputs",
      "integers-and-doubles",
      "lengths-in-loops",
      "literal-chains-32-char-literal",
      "literal-chains-every-representation-1",
      "literal-chains-every-representation-2",
      "literal-chains-ropes-and-16-bit",
      "literal-compared-outside-loops",
      "literal-tables-near-misses",
      "locale-compare",
      "long-regexp-source-uncompiled",
      "long-rope-regexps-recreated-after-gc",
      "long-running-closures-via-map",
      "map-entries",
      "match-all",
      "one-code-unit-compared",
      "regexp-literals-inline-or-stored",
      "regexp-shared-lead-surrogate-classes",
      "regexp-source-hash-collision",
      "replace-all",
      "replace-matching-and-non-matching",
      "rope-compared-again",
      "run-once-async-and-element-stores",
      "scanning-by-code-units",
      "searches-outside-loops",
      "single-characters",
      "slice-substring-substr",
      "spread-of-string-keys",
      "string-conversion-of-primitive-union",
      "string-iteration",
      "string-literal-length",
      "string-raw-with-getters",
      "string-switch-on-unknown-values",
      "strings-built-and-consumed-locally",
      "strings-read-in-loops",
      "substring-operations-outside-loops",
      "substrings-of-widened-16-bit-string",
      "switch",
      "switch-on-string-literals",
      "trim",
      "try-await-yield-in-string-loops",
      "union-discriminants-compared-with-literals",
      "untyped-arguments",
    ]),
    "characters-outside-loops-untyped.json": `{ "skipInVariant": { "validate-collecting": "it allocates so much that it runs for minutes where every allocation collects, and a run is killed after 90 seconds" } }
`,
    "literal-chains-every-representation-1-untyped.json": `{
  "env": {
    "JSC_useDollarVM": "1"
  }
}
`,
    "rope-compared-again-untyped.json": `{
  "env": {
    "JSC_useDollarVM": "1"
  }
}
`,
    "searches-outside-loops-untyped.json": `{ "skipInVariant": { "validate-collecting": "it allocates so much that it runs for minutes where every allocation collects, and a run is killed after 90 seconds" } }
`,
    "constants-in-hot-and-cold-code.ts": text(
      `const seen = new Set<string>();
seen.add("k0000").add("k0001-x").add("k0002é").add("k0003日本").add("k0004_long_tail").add("k0005").add("k0006-x").add("k0007é").add("k0008日本").add("k0009_long_tail").add("k0010").add("k0011-x").add("k0012é").add("k0013日本").add("k0014_long_tail").add("k0015").add("k0016-x").add("k0017é").add("k0018日本").add("k0019_long_tail").add("k0020").add("k0021-x").add("k0022é").add("k0023日本").add("k0024_long_tail");
seen.add("k0025").add("k0026-x").add("k0027é").add("k0028日本").add("k0029_long_tail").add("k0030").add("k0031-x").add("k0032é").add("k0033日本").add("k0034_long_tail").add("k0035").add("k0036-x").add("k0037é").add("k0038日本").add("k0039_long_tail").add("k0040").add("k0041-x").add("k0042é").add("k0043日本").add("k0044_long_tail").add("k0045").add("k0046-x").add("k0047é").add("k0048日本").add("k0049_long_tail");
seen.add("k0050").add("k0051-x").add("k0052é").add("k0053日本").add("k0054_long_tail").add("k0055").add("k0056-x").add("k0057é").add("k0058日本").add("k0059_long_tail").add("k0060").add("k0061-x").add("k0062é").add("k0063日本").add("k0064_long_tail").add("k0065").add("k0066-x").add("k0067é").add("k0068日本").add("k0069_long_tail").add("k0070").add("k0071-x").add("k0072é").add("k0073日本").add("k0074_long_tail");
seen.add("k0075").add("k0076-x").add("k0077é").add("k0078日本").add("k0079_long_tail").add("k0080").add("k0081-x").add("k0082é").add("k0083日本").add("k0084_long_tail").add("k0085").add("k0086-x").add("k0087é").add("k0088日本").add("k0089_long_tail").add("k0090").add("k0091-x").add("k0092é").add("k0093日本").add("k0094_long_tail").add("k0095").add("k0096-x").add("k0097é").add("k0098日本").add("k0099_long_tail");
seen.add("k0100").add("k0101-x").add("k0102é").add("k0103日本").add("k0104_long_tail").add("k0105").add("k0106-x").add("k0107é").add("k0108日本").add("k0109_long_tail").add("k0110").add("k0111-x").add("k0112é").add("k0113日本").add("k0114_long_tail").add("k0115").add("k0116-x").add("k0117é").add("k0118日本").add("k0119_long_tail").add("k0120").add("k0121-x").add("k0122é").add("k0123日本").add("k0124_long_tail");
seen.add("k0125").add("k0126-x").add("k0127é").add("k0128日本").add("k0129_long_tail").add("k0130").add("k0131-x").add("k0132é").add("k0133日本").add("k0134_long_tail").add("k0135").add("k0136-x").add("k0137é").add("k0138日本").add("k0139_long_tail").add("k0140").add("k0141-x").add("k0142é").add("k0143日本").add("k0144_long_tail").add("k0145").add("k0146-x").add("k0147é").add("k0148日本").add("k0149_long_tail");
seen.add("k0150").add("k0151-x").add("k0152é").add("k0153日本").add("k0154_long_tail").add("k0155").add("k0156-x").add("k0157é").add("k0158日本").add("k0159_long_tail").add("k0160").add("k0161-x").add("k0162é").add("k0163日本").add("k0164_long_tail").add("k0165").add("k0166-x").add("k0167é").add("k0168日本").add("k0169_long_tail").add("k0170").add("k0171-x").add("k0172é").add("k0173日本").add("k0174_long_tail");
seen.add("k0175").add("k0176-x").add("k0177é").add("k0178日本").add("k0179_long_tail").add("k0180").add("k0181-x").add("k0182é").add("k0183日本").add("k0184_long_tail").add("k0185").add("k0186-x").add("k0187é").add("k0188日本").add("k0189_long_tail").add("k0190").add("k0191-x").add("k0192é").add("k0193日本").add("k0194_long_tail").add("k0195").add("k0196-x").add("k0197é").add("k0198日本").add("k0199_long_tail");
seen.add("k0200").add("k0201-x").add("k0202é").add("k0203日本").add("k0204_long_tail").add("k0205").add("k0206-x").add("k0207é").add("k0208日本").add("k0209_long_tail").add("k0210").add("k0211-x").add("k0212é").add("k0213日本").add("k0214_long_tail").add("k0215").add("k0216-x").add("k0217é").add("k0218日本").add("k0219_long_tail").add("k0220").add("k0221-x").add("k0222é").add("k0223日本").add("k0224_long_tail");
seen.add("k0225").add("k0226-x").add("k0227é").add("k0228日本").add("k0229_long_tail").add("k0230").add("k0231-x").add("k0232é").add("k0233日本").add("k0234_long_tail").add("k0235").add("k0236-x").add("k0237é").add("k0238日本").add("k0239_long_tail").add("k0240").add("k0241-x").add("k0242é").add("k0243日本").add("k0244_long_tail").add("k0245").add("k0246-x").add("k0247é").add("k0248日本").add("k0249_long_tail");
seen.add("k0250").add("k0251-x").add("k0252é").add("k0253日本").add("k0254_long_tail").add("k0255").add("k0256-x").add("k0257é").add("k0258日本").add("k0259_long_tail").add("k0260").add("k0261-x").add("k0262é").add("k0263日本").add("k0264_long_tail").add("k0265").add("k0266-x").add("k0267é").add("k0268日本").add("k0269_long_tail").add("k0270").add("k0271-x").add("k0272é").add("k0273日本").add("k0274_long_tail");
seen.add("k0275").add("k0276-x").add("k0277é").add("k0278日本").add("k0279_long_tail").add("k0280").add("k0281-x").add("k0282é").add("k0283日本").add("k0284_long_tail").add("k0285").add("k0286-x").add("k0287é").add("k0288日本").add("k0289_long_tail").add("k0290").add("k0291-x").add("k0292é").add("k0293日本").add("k0294_long_tail").add("k0295").add("k0296-x").add("k0297é").add("k0298日本").add("k0299_long_tail");
seen.add("k0300").add("k0301-x").add("k0302é").add("k0303日本").add("k0304_long_tail").add("k0305").add("k0306-x").add("k0307é").add("k0308日本").add("k0309_long_tail").add("k0310").add("k0311-x").add("k0312é").add("k0313日本").add("k0314_long_tail").add("k0315").add("k0316-x").add("k0317é").add("k0318日本").add("k0319_long_tail").add("k0320").add("k0321-x").add("k0322é").add("k0323日本").add("k0324_long_tail");
seen.add("k0325").add("k0326-x").add("k0327é").add("k0328日本").add("k0329_long_tail").add("k0330").add("k0331-x").add("k0332é").add("k0333日本").add("k0334_long_tail").add("k0335").add("k0336-x").add("k0337é").add("k0338日本").add("k0339_long_tail").add("k0340").add("k0341-x").add("k0342é").add("k0343日本").add("k0344_long_tail").add("k0345").add("k0346-x").add("k0347é").add("k0348日本").add("k0349_long_tail");
seen.add("k0350").add("k0351-x").add("k0352é").add("k0353日本").add("k0354_long_tail").add("k0355").add("k0356-x").add("k0357é").add("k0358日本").add("k0359_long_tail").add("k0360").add("k0361-x").add("k0362é").add("k0363日本").add("k0364_long_tail").add("k0365").add("k0366-x").add("k0367é").add("k0368日本").add("k0369_long_tail").add("k0370").add("k0371-x").add("k0372é").add("k0373日本").add("k0374_long_tail");
seen.add("k0375").add("k0376-x").add("k0377é").add("k0378日本").add("k0379_long_tail").add("k0380").add("k0381-x").add("k0382é").add("k0383日本").add("k0384_long_tail").add("k0385").add("k0386-x").add("k0387é").add("k0388日本").add("k0389_long_tail").add("k0390").add("k0391-x").add("k0392é").add("k0393日本").add("k0394_long_tail").add("k0395").add("k0396-x").add("k0397é").add("k0398日本").add("k0399_long_tail");
seen.add("k0400").add("k0401-x").add("k0402é").add("k0403日本").add("k0404_long_tail").add("k0405").add("k0406-x").add("k0407é").add("k0408日本").add("k0409_long_tail").add("k0410").add("k0411-x").add("k0412é").add("k0413日本").add("k0414_long_tail").add("k0415").add("k0416-x").add("k0417é").add("k0418日本").add("k0419_long_tail").add("k0420").add("k0421-x").add("k0422é").add("k0423日本").add("k0424_long_tail");
seen.add("k0425").add("k0426-x").add("k0427é").add("k0428日本").add("k0429_long_tail").add("k0430").add("k0431-x").add("k0432é").add("k0433日本").add("k0434_long_tail").add("k0435").add("k0436-x").add("k0437é").add("k0438日本").add("k0439_long_tail").add("k0440").add("k0441-x").add("k0442é").add("k0443日本").add("k0444_long_tail").add("k0445").add("k0446-x").add("k0447é").add("k0448日本").add("k0449_long_tail");
seen.add("k0450").add("k0451-x").add("k0452é").add("k0453日本").add("k0454_long_tail").add("k0455").add("k0456-x").add("k0457é").add("k0458日本").add("k0459_long_tail").add("k0460").add("k0461-x").add("k0462é").add("k0463日本").add("k0464_long_tail").add("k0465").add("k0466-x").add("k0467é").add("k0468日本").add("k0469_long_tail").add("k0470").add("k0471-x").add("k0472é").add("k0473日本").add("k0474_long_tail");
seen.add("k0475").add("k0476-x").add("k0477é").add("k0478日本").add("k0479_long_tail").add("k0480").add("k0481-x").add("k0482é").add("k0483日本").add("k0484_long_tail").add("k0485").add("k0486-x").add("k0487é").add("k0488日本").add("k0489_long_tail").add("k0490").add("k0491-x").add("k0492é").add("k0493日本").add("k0494_long_tail").add("k0495").add("k0496-x").add("k0497é").add("k0498日本").add("k0499_long_tail");
seen.add("k0500").add("k0501-x").add("k0502é").add("k0503日本").add("k0504_long_tail").add("k0505").add("k0506-x").add("k0507é").add("k0508日本").add("k0509_long_tail").add("k0510").add("k0511-x").add("k0512é").add("k0513日本").add("k0514_long_tail").add("k0515").add("k0516-x").add("k0517é").add("k0518日本").add("k0519_long_tail").add("k0520").add("k0521-x").add("k0522é").add("k0523日本").add("k0524_long_tail");
seen.add("k0525").add("k0526-x").add("k0527é").add("k0528日本").add("k0529_long_tail").add("k0530").add("k0531-x").add("k0532é").add("k0533日本").add("k0534_long_tail").add("k0535").add("k0536-x").add("k0537é").add("k0538日本").add("k0539_long_tail").add("k0540").add("k0541-x").add("k0542é").add("k0543日本").add("k0544_long_tail").add("k0545").add("k0546-x").add("k0547é").add("k0548日本").add("k0549_long_tail");
seen.add("k0550").add("k0551-x").add("k0552é").add("k0553日本").add("k0554_long_tail").add("k0555").add("k0556-x").add("k0557é").add("k0558日本").add("k0559_long_tail").add("k0560").add("k0561-x").add("k0562é").add("k0563日本").add("k0564_long_tail").add("k0565").add("k0566-x").add("k0567é").add("k0568日本").add("k0569_long_tail").add("k0570").add("k0571-x").add("k0572é").add("k0573日本").add("k0574_long_tail");
seen.add("k0575").add("k0576-x").add("k0577é").add("k0578日本").add("k0579_long_tail").add("k0580").add("k0581-x").add("k0582é").add("k0583日本").add("k0584_long_tail").add("k0585").add("k0586-x").add("k0587é").add("k0588日本").add("k0589_long_tail").add("k0590").add("k0591-x").add("k0592é").add("k0593日本").add("k0594_long_tail").add("k0595").add("k0596-x").add("k0597é").add("k0598日本").add("k0599_long_tail");
seen.add("k0600").add("k0601-x").add("k0602é").add("k0603日本").add("k0604_long_tail").add("k0605").add("k0606-x").add("k0607é").add("k0608日本").add("k0609_long_tail").add("k0610").add("k0611-x").add("k0612é").add("k0613日本").add("k0614_long_tail").add("k0615").add("k0616-x").add("k0617é").add("k0618日本").add("k0619_long_tail").add("k0620").add("k0621-x").add("k0622é").add("k0623日本").add("k0624_long_tail");
seen.add("k0625").add("k0626-x").add("k0627é").add("k0628日本").add("k0629_long_tail").add("k0630").add("k0631-x").add("k0632é").add("k0633日本").add("k0634_long_tail").add("k0635").add("k0636-x").add("k0637é").add("k0638日本").add("k0639_long_tail").add("k0640").add("k0641-x").add("k0642é").add("k0643日本").add("k0644_long_tail").add("k0645").add("k0646-x").add("k0647é").add("k0648日本").add("k0649_long_tail");
seen.add("k0650").add("k0651-x").add("k0652é").add("k0653日本").add("k0654_long_tail").add("k0655").add("k0656-x").add("k0657é").add("k0658日本").add("k0659_long_tail").add("k0660").add("k0661-x").add("k0662é").add("k0663日本").add("k0664_long_tail").add("k0665").add("k0666-x").add("k0667é").add("k0668日本").add("k0669_long_tail").add("k0670").add("k0671-x").add("k0672é").add("k0673日本").add("k0674_long_tail");
seen.add("k0675").add("k0676-x").add("k0677é").add("k0678日本").add("k0679_long_tail").add("k0680").add("k0681-x").add("k0682é").add("k0683日本").add("k0684_long_tail").add("k0685").add("k0686-x").add("k0687é").add("k0688日本").add("k0689_long_tail").add("k0690").add("k0691-x").add("k0692é").add("k0693日本").add("k0694_long_tail").add("k0695").add("k0696-x").add("k0697é").add("k0698日本").add("k0699_long_tail");
seen.add("k0700").add("k0701-x").add("k0702é").add("k0703日本").add("k0704_long_tail").add("k0705").add("k0706-x").add("k0707é").add("k0708日本").add("k0709_long_tail").add("k0710").add("k0711-x").add("k0712é").add("k0713日本").add("k0714_long_tail").add("k0715").add("k0716-x").add("k0717é").add("k0718日本").add("k0719_long_tail").add("k0720").add("k0721-x").add("k0722é").add("k0723日本").add("k0724_long_tail");
seen.add("k0725").add("k0726-x").add("k0727é").add("k0728日本").add("k0729_long_tail").add("k0730").add("k0731-x").add("k0732é").add("k0733日本").add("k0734_long_tail").add("k0735").add("k0736-x").add("k0737é").add("k0738日本").add("k0739_long_tail").add("k0740").add("k0741-x").add("k0742é").add("k0743日本").add("k0744_long_tail").add("k0745").add("k0746-x").add("k0747é").add("k0748日本").add("k0749_long_tail");
seen.add("k0750").add("k0751-x").add("k0752é").add("k0753日本").add("k0754_long_tail").add("k0755").add("k0756-x").add("k0757é").add("k0758日本").add("k0759_long_tail").add("k0760").add("k0761-x").add("k0762é").add("k0763日本").add("k0764_long_tail").add("k0765").add("k0766-x").add("k0767é").add("k0768日本").add("k0769_long_tail").add("k0770").add("k0771-x").add("k0772é").add("k0773日本").add("k0774_long_tail");
seen.add("k0775").add("k0776-x").add("k0777é").add("k0778日本").add("k0779_long_tail").add("k0780").add("k0781-x").add("k0782é").add("k0783日本").add("k0784_long_tail").add("k0785").add("k0786-x").add("k0787é").add("k0788日本").add("k0789_long_tail").add("k0790").add("k0791-x").add("k0792é").add("k0793日本").add("k0794_long_tail").add("k0795").add("k0796-x").add("k0797é").add("k0798日本").add("k0799_long_tail");
seen.add("k0800").add("k0801-x").add("k0802é").add("k0803日本").add("k0804_long_tail").add("k0805").add("k0806-x").add("k0807é").add("k0808日本").add("k0809_long_tail").add("k0810").add("k0811-x").add("k0812é").add("k0813日本").add("k0814_long_tail").add("k0815").add("k0816-x").add("k0817é").add("k0818日本").add("k0819_long_tail").add("k0820").add("k0821-x").add("k0822é").add("k0823日本").add("k0824_long_tail");
seen.add("k0825").add("k0826-x").add("k0827é").add("k0828日本").add("k0829_long_tail").add("k0830").add("k0831-x").add("k0832é").add("k0833日本").add("k0834_long_tail").add("k0835").add("k0836-x").add("k0837é").add("k0838日本").add("k0839_long_tail").add("k0840").add("k0841-x").add("k0842é").add("k0843日本").add("k0844_long_tail").add("k0845").add("k0846-x").add("k0847é").add("k0848日本").add("k0849_long_tail");
seen.add("k0850").add("k0851-x").add("k0852é").add("k0853日本").add("k0854_long_tail").add("k0855").add("k0856-x").add("k0857é").add("k0858日本").add("k0859_long_tail").add("k0860").add("k0861-x").add("k0862é").add("k0863日本").add("k0864_long_tail").add("k0865").add("k0866-x").add("k0867é").add("k0868日本").add("k0869_long_tail").add("k0870").add("k0871-x").add("k0872é").add("k0873日本").add("k0874_long_tail");
seen.add("k0875").add("k0876-x").add("k0877é").add("k0878日本").add("k0879_long_tail").add("k0880").add("k0881-x").add("k0882é").add("k0883日本").add("k0884_long_tail").add("k0885").add("k0886-x").add("k0887é").add("k0888日本").add("k0889_long_tail").add("k0890").add("k0891-x").add("k0892é").add("k0893日本").add("k0894_long_tail").add("k0895").add("k0896-x").add("k0897é").add("k0898日本").add("k0899_long_tail");
seen.add("k0900").add("k0901-x").add("k0902é").add("k0903日本").add("k0904_long_tail").add("k0905").add("k0906-x").add("k0907é").add("k0908日本").add("k0909_long_tail").add("k0910").add("k0911-x").add("k0912é").add("k0913日本").add("k0914_long_tail").add("k0915").add("k0916-x").add("k0917é").add("k0918日本").add("k0919_long_tail").add("k0920").add("k0921-x").add("k0922é").add("k0923日本").add("k0924_long_tail");
seen.add("k0925").add("k0926-x").add("k0927é").add("k0928日本").add("k0929_long_tail").add("k0930").add("k0931-x").add("k0932é").add("k0933日本").add("k0934_long_tail").add("k0935").add("k0936-x").add("k0937é").add("k0938日本").add("k0939_long_tail").add("k0940").add("k0941-x").add("k0942é").add("k0943日本").add("k0944_long_tail").add("k0945").add("k0946-x").add("k0947é").add("k0948日本").add("k0949_long_tail");
seen.add("k0950").add("k0951-x").add("k0952é").add("k0953日本").add("k0954_long_tail").add("k0955").add("k0956-x").add("k0957é").add("k0958日本").add("k0959_long_tail").add("k0960").add("k0961-x").add("k0962é").add("k0963日本").add("k0964_long_tail").add("k0965").add("k0966-x").add("k0967é").add("k0968日本").add("k0969_long_tail").add("k0970").add("k0971-x").add("k0972é").add("k0973日本").add("k0974_long_tail");
seen.add("k0975").add("k0976-x").add("k0977é").add("k0978日本").add("k0979_long_tail").add("k0980").add("k0981-x").add("k0982é").add("k0983日本").add("k0984_long_tail").add("k0985").add("k0986-x").add("k0987é").add("k0988日本").add("k0989_long_tail").add("k0990").add("k0991-x").add("k0992é").add("k0993日本").add("k0994_long_tail").add("k0995").add("k0996-x").add("k0997é").add("k0998日本").add("k0999_long_tail");`,
      [
        160,
        n =>
          `seen.add("k${25 * n + 1000}").add("k${25 * n + 1001}-x").add("k${25 * n + 1002}é").add("k${25 * n + 1003}日本").add("k${25 * n + 1004}_long_tail").add("k${25 * n + 1005}").add("k${25 * n + 1006}-x").add("k${25 * n + 1007}é").add("k${25 * n + 1008}日本").add("k${25 * n + 1009}_long_tail").add("k${25 * n + 1010}").add("k${25 * n + 1011}-x").add("k${25 * n + 1012}é").add("k${25 * n + 1013}日本").add("k${25 * n + 1014}_long_tail").add("k${25 * n + 1015}").add("k${25 * n + 1016}-x").add("k${25 * n + 1017}é").add("k${25 * n + 1018}日本").add("k${25 * n + 1019}_long_tail").add("k${25 * n + 1020}").add("k${25 * n + 1021}-x").add("k${25 * n + 1022}é").add("k${25 * n + 1023}日本").add("k${25 * n + 1024}_long_tail");`,
      ],
      `seen.add("often0").add("often1").add("often2").add("often3").add("often4").add("often5").add("often6").add("often7").add("").add("a").add("é").add("日");
console.log(seen.size);

const readOnce = new Set<string>();
readOnce.add("once00").add("once01").add("once02").add("once03").add("once04").add("once05").add("once06").add("once07").add("once08").add("once09").add("once10").add("once11").add("once12").add("once13").add("once14").add("once15").add("once16").add("once17").add("once18").add("once19").add("once20").add("once21").add("once22").add("once23").add("once24");
readOnce.add("once25").add("once26").add("once27").add("once28").add("once29").add("once30").add("once31").add("once32").add("once33").add("once34").add("once35").add("once36").add("once37").add("once38").add("once39").add("once40").add("once41").add("once42").add("once43").add("once44").add("once45").add("once46").add("once47").add("once48").add("once49");
readOnce.add("once50").add("once51").add("once52").add("once53").add("once54").add("once55").add("once56").add("once57").add("once58").add("once59").add("once60").add("once61").add("once62").add("once63").add("once64").add("once65").add("once66").add("once67").add("once68").add("once69").add("once70").add("once71").add("once72").add("once73").add("once74");
readOnce.add("once75").add("once76").add("once77").add("once78").add("once79").add("once80").add("once81").add("once82").add("once83").add("once84").add("once85").add("once86").add("once87").add("once88").add("once89").add("once90").add("once91").add("once92").add("once93").add("once94").add("once95").add("once96").add("once97").add("once98").add("once99");
console.log(readOnce.size, [...readOnce].join("").length);

Bun.gc(true);

function group00(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0000") && strings.has("k0001-x") && strings.has("k0002é") && strings.has("k0003日本") && strings.has("k0004_long_tail") && strings.has("k0005") && strings.has("k0006-x") && strings.has("k0007é") && strings.has("k0008日本") && strings.has("k0009_long_tail") && strings.has("k0010") && strings.has("k0011-x") && strings.has("k0012é") && strings.has("k0013日本") && strings.has("k0014_long_tail") && strings.has("k0015") && strings.has("k0016-x") && strings.has("k0017é") && strings.has("k0018日本") && strings.has("k0019_long_tail") && strings.has("k0020") && strings.has("k0021-x") && strings.has("k0022é") && strings.has("k0023日本") && strings.has("k0024_long_tail")) hits++;
    if (strings.has("k0025") && strings.has("k0026-x") && strings.has("k0027é") && strings.has("k0028日本") && strings.has("k0029_long_tail") && strings.has("k0030") && strings.has("k0031-x") && strings.has("k0032é") && strings.has("k0033日本") && strings.has("k0034_long_tail") && strings.has("k0035") && strings.has("k0036-x") && strings.has("k0037é") && strings.has("k0038日本") && strings.has("k0039_long_tail") && strings.has("k0040") && strings.has("k0041-x") && strings.has("k0042é") && strings.has("k0043日本") && strings.has("k0044_long_tail") && strings.has("k0045") && strings.has("k0046-x") && strings.has("k0047é") && strings.has("k0048日本") && strings.has("k0049_long_tail")) hits++;
    if (strings.has("k0050") && strings.has("k0051-x") && strings.has("k0052é") && strings.has("k0053日本") && strings.has("k0054_long_tail") && strings.has("k0055") && strings.has("k0056-x") && strings.has("k0057é") && strings.has("k0058日本") && strings.has("k0059_long_tail") && strings.has("k0060") && strings.has("k0061-x") && strings.has("k0062é") && strings.has("k0063日本") && strings.has("k0064_long_tail") && strings.has("k0065") && strings.has("k0066-x") && strings.has("k0067é") && strings.has("k0068日本") && strings.has("k0069_long_tail") && strings.has("k0070") && strings.has("k0071-x") && strings.has("k0072é") && strings.has("k0073日本") && strings.has("k0074_long_tail")) hits++;
    if (strings.has("k0075") && strings.has("k0076-x") && strings.has("k0077é") && strings.has("k0078日本") && strings.has("k0079_long_tail") && strings.has("k0080") && strings.has("k0081-x") && strings.has("k0082é") && strings.has("k0083日本") && strings.has("k0084_long_tail") && strings.has("k0085") && strings.has("k0086-x") && strings.has("k0087é") && strings.has("k0088日本") && strings.has("k0089_long_tail") && strings.has("k0090") && strings.has("k0091-x") && strings.has("k0092é") && strings.has("k0093日本") && strings.has("k0094_long_tail") && strings.has("k0095") && strings.has("k0096-x") && strings.has("k0097é") && strings.has("k0098日本") && strings.has("k0099_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0000?")) hits -= 1000;
    strings.add("k0000").add("k0099_long_tail");
  }
  return hits;
}
function group01(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0100") && strings.has("k0101-x") && strings.has("k0102é") && strings.has("k0103日本") && strings.has("k0104_long_tail") && strings.has("k0105") && strings.has("k0106-x") && strings.has("k0107é") && strings.has("k0108日本") && strings.has("k0109_long_tail") && strings.has("k0110") && strings.has("k0111-x") && strings.has("k0112é") && strings.has("k0113日本") && strings.has("k0114_long_tail") && strings.has("k0115") && strings.has("k0116-x") && strings.has("k0117é") && strings.has("k0118日本") && strings.has("k0119_long_tail") && strings.has("k0120") && strings.has("k0121-x") && strings.has("k0122é") && strings.has("k0123日本") && strings.has("k0124_long_tail")) hits++;
    if (strings.has("k0125") && strings.has("k0126-x") && strings.has("k0127é") && strings.has("k0128日本") && strings.has("k0129_long_tail") && strings.has("k0130") && strings.has("k0131-x") && strings.has("k0132é") && strings.has("k0133日本") && strings.has("k0134_long_tail") && strings.has("k0135") && strings.has("k0136-x") && strings.has("k0137é") && strings.has("k0138日本") && strings.has("k0139_long_tail") && strings.has("k0140") && strings.has("k0141-x") && strings.has("k0142é") && strings.has("k0143日本") && strings.has("k0144_long_tail") && strings.has("k0145") && strings.has("k0146-x") && strings.has("k0147é") && strings.has("k0148日本") && strings.has("k0149_long_tail")) hits++;
    if (strings.has("k0150") && strings.has("k0151-x") && strings.has("k0152é") && strings.has("k0153日本") && strings.has("k0154_long_tail") && strings.has("k0155") && strings.has("k0156-x") && strings.has("k0157é") && strings.has("k0158日本") && strings.has("k0159_long_tail") && strings.has("k0160") && strings.has("k0161-x") && strings.has("k0162é") && strings.has("k0163日本") && strings.has("k0164_long_tail") && strings.has("k0165") && strings.has("k0166-x") && strings.has("k0167é") && strings.has("k0168日本") && strings.has("k0169_long_tail") && strings.has("k0170") && strings.has("k0171-x") && strings.has("k0172é") && strings.has("k0173日本") && strings.has("k0174_long_tail")) hits++;
    if (strings.has("k0175") && strings.has("k0176-x") && strings.has("k0177é") && strings.has("k0178日本") && strings.has("k0179_long_tail") && strings.has("k0180") && strings.has("k0181-x") && strings.has("k0182é") && strings.has("k0183日本") && strings.has("k0184_long_tail") && strings.has("k0185") && strings.has("k0186-x") && strings.has("k0187é") && strings.has("k0188日本") && strings.has("k0189_long_tail") && strings.has("k0190") && strings.has("k0191-x") && strings.has("k0192é") && strings.has("k0193日本") && strings.has("k0194_long_tail") && strings.has("k0195") && strings.has("k0196-x") && strings.has("k0197é") && strings.has("k0198日本") && strings.has("k0199_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0100?")) hits -= 1000;
    strings.add("k0100").add("k0199_long_tail");
  }
  return hits;
}
function group02(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0200") && strings.has("k0201-x") && strings.has("k0202é") && strings.has("k0203日本") && strings.has("k0204_long_tail") && strings.has("k0205") && strings.has("k0206-x") && strings.has("k0207é") && strings.has("k0208日本") && strings.has("k0209_long_tail") && strings.has("k0210") && strings.has("k0211-x") && strings.has("k0212é") && strings.has("k0213日本") && strings.has("k0214_long_tail") && strings.has("k0215") && strings.has("k0216-x") && strings.has("k0217é") && strings.has("k0218日本") && strings.has("k0219_long_tail") && strings.has("k0220") && strings.has("k0221-x") && strings.has("k0222é") && strings.has("k0223日本") && strings.has("k0224_long_tail")) hits++;
    if (strings.has("k0225") && strings.has("k0226-x") && strings.has("k0227é") && strings.has("k0228日本") && strings.has("k0229_long_tail") && strings.has("k0230") && strings.has("k0231-x") && strings.has("k0232é") && strings.has("k0233日本") && strings.has("k0234_long_tail") && strings.has("k0235") && strings.has("k0236-x") && strings.has("k0237é") && strings.has("k0238日本") && strings.has("k0239_long_tail") && strings.has("k0240") && strings.has("k0241-x") && strings.has("k0242é") && strings.has("k0243日本") && strings.has("k0244_long_tail") && strings.has("k0245") && strings.has("k0246-x") && strings.has("k0247é") && strings.has("k0248日本") && strings.has("k0249_long_tail")) hits++;
    if (strings.has("k0250") && strings.has("k0251-x") && strings.has("k0252é") && strings.has("k0253日本") && strings.has("k0254_long_tail") && strings.has("k0255") && strings.has("k0256-x") && strings.has("k0257é") && strings.has("k0258日本") && strings.has("k0259_long_tail") && strings.has("k0260") && strings.has("k0261-x") && strings.has("k0262é") && strings.has("k0263日本") && strings.has("k0264_long_tail") && strings.has("k0265") && strings.has("k0266-x") && strings.has("k0267é") && strings.has("k0268日本") && strings.has("k0269_long_tail") && strings.has("k0270") && strings.has("k0271-x") && strings.has("k0272é") && strings.has("k0273日本") && strings.has("k0274_long_tail")) hits++;
    if (strings.has("k0275") && strings.has("k0276-x") && strings.has("k0277é") && strings.has("k0278日本") && strings.has("k0279_long_tail") && strings.has("k0280") && strings.has("k0281-x") && strings.has("k0282é") && strings.has("k0283日本") && strings.has("k0284_long_tail") && strings.has("k0285") && strings.has("k0286-x") && strings.has("k0287é") && strings.has("k0288日本") && strings.has("k0289_long_tail") && strings.has("k0290") && strings.has("k0291-x") && strings.has("k0292é") && strings.has("k0293日本") && strings.has("k0294_long_tail") && strings.has("k0295") && strings.has("k0296-x") && strings.has("k0297é") && strings.has("k0298日本") && strings.has("k0299_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0200?")) hits -= 1000;
    strings.add("k0200").add("k0299_long_tail");
  }
  return hits;
}
function group03(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0300") && strings.has("k0301-x") && strings.has("k0302é") && strings.has("k0303日本") && strings.has("k0304_long_tail") && strings.has("k0305") && strings.has("k0306-x") && strings.has("k0307é") && strings.has("k0308日本") && strings.has("k0309_long_tail") && strings.has("k0310") && strings.has("k0311-x") && strings.has("k0312é") && strings.has("k0313日本") && strings.has("k0314_long_tail") && strings.has("k0315") && strings.has("k0316-x") && strings.has("k0317é") && strings.has("k0318日本") && strings.has("k0319_long_tail") && strings.has("k0320") && strings.has("k0321-x") && strings.has("k0322é") && strings.has("k0323日本") && strings.has("k0324_long_tail")) hits++;
    if (strings.has("k0325") && strings.has("k0326-x") && strings.has("k0327é") && strings.has("k0328日本") && strings.has("k0329_long_tail") && strings.has("k0330") && strings.has("k0331-x") && strings.has("k0332é") && strings.has("k0333日本") && strings.has("k0334_long_tail") && strings.has("k0335") && strings.has("k0336-x") && strings.has("k0337é") && strings.has("k0338日本") && strings.has("k0339_long_tail") && strings.has("k0340") && strings.has("k0341-x") && strings.has("k0342é") && strings.has("k0343日本") && strings.has("k0344_long_tail") && strings.has("k0345") && strings.has("k0346-x") && strings.has("k0347é") && strings.has("k0348日本") && strings.has("k0349_long_tail")) hits++;
    if (strings.has("k0350") && strings.has("k0351-x") && strings.has("k0352é") && strings.has("k0353日本") && strings.has("k0354_long_tail") && strings.has("k0355") && strings.has("k0356-x") && strings.has("k0357é") && strings.has("k0358日本") && strings.has("k0359_long_tail") && strings.has("k0360") && strings.has("k0361-x") && strings.has("k0362é") && strings.has("k0363日本") && strings.has("k0364_long_tail") && strings.has("k0365") && strings.has("k0366-x") && strings.has("k0367é") && strings.has("k0368日本") && strings.has("k0369_long_tail") && strings.has("k0370") && strings.has("k0371-x") && strings.has("k0372é") && strings.has("k0373日本") && strings.has("k0374_long_tail")) hits++;
    if (strings.has("k0375") && strings.has("k0376-x") && strings.has("k0377é") && strings.has("k0378日本") && strings.has("k0379_long_tail") && strings.has("k0380") && strings.has("k0381-x") && strings.has("k0382é") && strings.has("k0383日本") && strings.has("k0384_long_tail") && strings.has("k0385") && strings.has("k0386-x") && strings.has("k0387é") && strings.has("k0388日本") && strings.has("k0389_long_tail") && strings.has("k0390") && strings.has("k0391-x") && strings.has("k0392é") && strings.has("k0393日本") && strings.has("k0394_long_tail") && strings.has("k0395") && strings.has("k0396-x") && strings.has("k0397é") && strings.has("k0398日本") && strings.has("k0399_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0300?")) hits -= 1000;
    strings.add("k0300").add("k0399_long_tail");
  }
  return hits;
}
function group04(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0400") && strings.has("k0401-x") && strings.has("k0402é") && strings.has("k0403日本") && strings.has("k0404_long_tail") && strings.has("k0405") && strings.has("k0406-x") && strings.has("k0407é") && strings.has("k0408日本") && strings.has("k0409_long_tail") && strings.has("k0410") && strings.has("k0411-x") && strings.has("k0412é") && strings.has("k0413日本") && strings.has("k0414_long_tail") && strings.has("k0415") && strings.has("k0416-x") && strings.has("k0417é") && strings.has("k0418日本") && strings.has("k0419_long_tail") && strings.has("k0420") && strings.has("k0421-x") && strings.has("k0422é") && strings.has("k0423日本") && strings.has("k0424_long_tail")) hits++;
    if (strings.has("k0425") && strings.has("k0426-x") && strings.has("k0427é") && strings.has("k0428日本") && strings.has("k0429_long_tail") && strings.has("k0430") && strings.has("k0431-x") && strings.has("k0432é") && strings.has("k0433日本") && strings.has("k0434_long_tail") && strings.has("k0435") && strings.has("k0436-x") && strings.has("k0437é") && strings.has("k0438日本") && strings.has("k0439_long_tail") && strings.has("k0440") && strings.has("k0441-x") && strings.has("k0442é") && strings.has("k0443日本") && strings.has("k0444_long_tail") && strings.has("k0445") && strings.has("k0446-x") && strings.has("k0447é") && strings.has("k0448日本") && strings.has("k0449_long_tail")) hits++;
    if (strings.has("k0450") && strings.has("k0451-x") && strings.has("k0452é") && strings.has("k0453日本") && strings.has("k0454_long_tail") && strings.has("k0455") && strings.has("k0456-x") && strings.has("k0457é") && strings.has("k0458日本") && strings.has("k0459_long_tail") && strings.has("k0460") && strings.has("k0461-x") && strings.has("k0462é") && strings.has("k0463日本") && strings.has("k0464_long_tail") && strings.has("k0465") && strings.has("k0466-x") && strings.has("k0467é") && strings.has("k0468日本") && strings.has("k0469_long_tail") && strings.has("k0470") && strings.has("k0471-x") && strings.has("k0472é") && strings.has("k0473日本") && strings.has("k0474_long_tail")) hits++;
    if (strings.has("k0475") && strings.has("k0476-x") && strings.has("k0477é") && strings.has("k0478日本") && strings.has("k0479_long_tail") && strings.has("k0480") && strings.has("k0481-x") && strings.has("k0482é") && strings.has("k0483日本") && strings.has("k0484_long_tail") && strings.has("k0485") && strings.has("k0486-x") && strings.has("k0487é") && strings.has("k0488日本") && strings.has("k0489_long_tail") && strings.has("k0490") && strings.has("k0491-x") && strings.has("k0492é") && strings.has("k0493日本") && strings.has("k0494_long_tail") && strings.has("k0495") && strings.has("k0496-x") && strings.has("k0497é") && strings.has("k0498日本") && strings.has("k0499_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0400?")) hits -= 1000;
    strings.add("k0400").add("k0499_long_tail");
  }
  return hits;
}
function group05(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0500") && strings.has("k0501-x") && strings.has("k0502é") && strings.has("k0503日本") && strings.has("k0504_long_tail") && strings.has("k0505") && strings.has("k0506-x") && strings.has("k0507é") && strings.has("k0508日本") && strings.has("k0509_long_tail") && strings.has("k0510") && strings.has("k0511-x") && strings.has("k0512é") && strings.has("k0513日本") && strings.has("k0514_long_tail") && strings.has("k0515") && strings.has("k0516-x") && strings.has("k0517é") && strings.has("k0518日本") && strings.has("k0519_long_tail") && strings.has("k0520") && strings.has("k0521-x") && strings.has("k0522é") && strings.has("k0523日本") && strings.has("k0524_long_tail")) hits++;
    if (strings.has("k0525") && strings.has("k0526-x") && strings.has("k0527é") && strings.has("k0528日本") && strings.has("k0529_long_tail") && strings.has("k0530") && strings.has("k0531-x") && strings.has("k0532é") && strings.has("k0533日本") && strings.has("k0534_long_tail") && strings.has("k0535") && strings.has("k0536-x") && strings.has("k0537é") && strings.has("k0538日本") && strings.has("k0539_long_tail") && strings.has("k0540") && strings.has("k0541-x") && strings.has("k0542é") && strings.has("k0543日本") && strings.has("k0544_long_tail") && strings.has("k0545") && strings.has("k0546-x") && strings.has("k0547é") && strings.has("k0548日本") && strings.has("k0549_long_tail")) hits++;
    if (strings.has("k0550") && strings.has("k0551-x") && strings.has("k0552é") && strings.has("k0553日本") && strings.has("k0554_long_tail") && strings.has("k0555") && strings.has("k0556-x") && strings.has("k0557é") && strings.has("k0558日本") && strings.has("k0559_long_tail") && strings.has("k0560") && strings.has("k0561-x") && strings.has("k0562é") && strings.has("k0563日本") && strings.has("k0564_long_tail") && strings.has("k0565") && strings.has("k0566-x") && strings.has("k0567é") && strings.has("k0568日本") && strings.has("k0569_long_tail") && strings.has("k0570") && strings.has("k0571-x") && strings.has("k0572é") && strings.has("k0573日本") && strings.has("k0574_long_tail")) hits++;
    if (strings.has("k0575") && strings.has("k0576-x") && strings.has("k0577é") && strings.has("k0578日本") && strings.has("k0579_long_tail") && strings.has("k0580") && strings.has("k0581-x") && strings.has("k0582é") && strings.has("k0583日本") && strings.has("k0584_long_tail") && strings.has("k0585") && strings.has("k0586-x") && strings.has("k0587é") && strings.has("k0588日本") && strings.has("k0589_long_tail") && strings.has("k0590") && strings.has("k0591-x") && strings.has("k0592é") && strings.has("k0593日本") && strings.has("k0594_long_tail") && strings.has("k0595") && strings.has("k0596-x") && strings.has("k0597é") && strings.has("k0598日本") && strings.has("k0599_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0500?")) hits -= 1000;
    strings.add("k0500").add("k0599_long_tail");
  }
  return hits;
}
function group06(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0600") && strings.has("k0601-x") && strings.has("k0602é") && strings.has("k0603日本") && strings.has("k0604_long_tail") && strings.has("k0605") && strings.has("k0606-x") && strings.has("k0607é") && strings.has("k0608日本") && strings.has("k0609_long_tail") && strings.has("k0610") && strings.has("k0611-x") && strings.has("k0612é") && strings.has("k0613日本") && strings.has("k0614_long_tail") && strings.has("k0615") && strings.has("k0616-x") && strings.has("k0617é") && strings.has("k0618日本") && strings.has("k0619_long_tail") && strings.has("k0620") && strings.has("k0621-x") && strings.has("k0622é") && strings.has("k0623日本") && strings.has("k0624_long_tail")) hits++;
    if (strings.has("k0625") && strings.has("k0626-x") && strings.has("k0627é") && strings.has("k0628日本") && strings.has("k0629_long_tail") && strings.has("k0630") && strings.has("k0631-x") && strings.has("k0632é") && strings.has("k0633日本") && strings.has("k0634_long_tail") && strings.has("k0635") && strings.has("k0636-x") && strings.has("k0637é") && strings.has("k0638日本") && strings.has("k0639_long_tail") && strings.has("k0640") && strings.has("k0641-x") && strings.has("k0642é") && strings.has("k0643日本") && strings.has("k0644_long_tail") && strings.has("k0645") && strings.has("k0646-x") && strings.has("k0647é") && strings.has("k0648日本") && strings.has("k0649_long_tail")) hits++;
    if (strings.has("k0650") && strings.has("k0651-x") && strings.has("k0652é") && strings.has("k0653日本") && strings.has("k0654_long_tail") && strings.has("k0655") && strings.has("k0656-x") && strings.has("k0657é") && strings.has("k0658日本") && strings.has("k0659_long_tail") && strings.has("k0660") && strings.has("k0661-x") && strings.has("k0662é") && strings.has("k0663日本") && strings.has("k0664_long_tail") && strings.has("k0665") && strings.has("k0666-x") && strings.has("k0667é") && strings.has("k0668日本") && strings.has("k0669_long_tail") && strings.has("k0670") && strings.has("k0671-x") && strings.has("k0672é") && strings.has("k0673日本") && strings.has("k0674_long_tail")) hits++;
    if (strings.has("k0675") && strings.has("k0676-x") && strings.has("k0677é") && strings.has("k0678日本") && strings.has("k0679_long_tail") && strings.has("k0680") && strings.has("k0681-x") && strings.has("k0682é") && strings.has("k0683日本") && strings.has("k0684_long_tail") && strings.has("k0685") && strings.has("k0686-x") && strings.has("k0687é") && strings.has("k0688日本") && strings.has("k0689_long_tail") && strings.has("k0690") && strings.has("k0691-x") && strings.has("k0692é") && strings.has("k0693日本") && strings.has("k0694_long_tail") && strings.has("k0695") && strings.has("k0696-x") && strings.has("k0697é") && strings.has("k0698日本") && strings.has("k0699_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0600?")) hits -= 1000;
    strings.add("k0600").add("k0699_long_tail");
  }
  return hits;
}
function group07(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0700") && strings.has("k0701-x") && strings.has("k0702é") && strings.has("k0703日本") && strings.has("k0704_long_tail") && strings.has("k0705") && strings.has("k0706-x") && strings.has("k0707é") && strings.has("k0708日本") && strings.has("k0709_long_tail") && strings.has("k0710") && strings.has("k0711-x") && strings.has("k0712é") && strings.has("k0713日本") && strings.has("k0714_long_tail") && strings.has("k0715") && strings.has("k0716-x") && strings.has("k0717é") && strings.has("k0718日本") && strings.has("k0719_long_tail") && strings.has("k0720") && strings.has("k0721-x") && strings.has("k0722é") && strings.has("k0723日本") && strings.has("k0724_long_tail")) hits++;
    if (strings.has("k0725") && strings.has("k0726-x") && strings.has("k0727é") && strings.has("k0728日本") && strings.has("k0729_long_tail") && strings.has("k0730") && strings.has("k0731-x") && strings.has("k0732é") && strings.has("k0733日本") && strings.has("k0734_long_tail") && strings.has("k0735") && strings.has("k0736-x") && strings.has("k0737é") && strings.has("k0738日本") && strings.has("k0739_long_tail") && strings.has("k0740") && strings.has("k0741-x") && strings.has("k0742é") && strings.has("k0743日本") && strings.has("k0744_long_tail") && strings.has("k0745") && strings.has("k0746-x") && strings.has("k0747é") && strings.has("k0748日本") && strings.has("k0749_long_tail")) hits++;
    if (strings.has("k0750") && strings.has("k0751-x") && strings.has("k0752é") && strings.has("k0753日本") && strings.has("k0754_long_tail") && strings.has("k0755") && strings.has("k0756-x") && strings.has("k0757é") && strings.has("k0758日本") && strings.has("k0759_long_tail") && strings.has("k0760") && strings.has("k0761-x") && strings.has("k0762é") && strings.has("k0763日本") && strings.has("k0764_long_tail") && strings.has("k0765") && strings.has("k0766-x") && strings.has("k0767é") && strings.has("k0768日本") && strings.has("k0769_long_tail") && strings.has("k0770") && strings.has("k0771-x") && strings.has("k0772é") && strings.has("k0773日本") && strings.has("k0774_long_tail")) hits++;
    if (strings.has("k0775") && strings.has("k0776-x") && strings.has("k0777é") && strings.has("k0778日本") && strings.has("k0779_long_tail") && strings.has("k0780") && strings.has("k0781-x") && strings.has("k0782é") && strings.has("k0783日本") && strings.has("k0784_long_tail") && strings.has("k0785") && strings.has("k0786-x") && strings.has("k0787é") && strings.has("k0788日本") && strings.has("k0789_long_tail") && strings.has("k0790") && strings.has("k0791-x") && strings.has("k0792é") && strings.has("k0793日本") && strings.has("k0794_long_tail") && strings.has("k0795") && strings.has("k0796-x") && strings.has("k0797é") && strings.has("k0798日本") && strings.has("k0799_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0700?")) hits -= 1000;
    strings.add("k0700").add("k0799_long_tail");
  }
  return hits;
}
function group08(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0800") && strings.has("k0801-x") && strings.has("k0802é") && strings.has("k0803日本") && strings.has("k0804_long_tail") && strings.has("k0805") && strings.has("k0806-x") && strings.has("k0807é") && strings.has("k0808日本") && strings.has("k0809_long_tail") && strings.has("k0810") && strings.has("k0811-x") && strings.has("k0812é") && strings.has("k0813日本") && strings.has("k0814_long_tail") && strings.has("k0815") && strings.has("k0816-x") && strings.has("k0817é") && strings.has("k0818日本") && strings.has("k0819_long_tail") && strings.has("k0820") && strings.has("k0821-x") && strings.has("k0822é") && strings.has("k0823日本") && strings.has("k0824_long_tail")) hits++;
    if (strings.has("k0825") && strings.has("k0826-x") && strings.has("k0827é") && strings.has("k0828日本") && strings.has("k0829_long_tail") && strings.has("k0830") && strings.has("k0831-x") && strings.has("k0832é") && strings.has("k0833日本") && strings.has("k0834_long_tail") && strings.has("k0835") && strings.has("k0836-x") && strings.has("k0837é") && strings.has("k0838日本") && strings.has("k0839_long_tail") && strings.has("k0840") && strings.has("k0841-x") && strings.has("k0842é") && strings.has("k0843日本") && strings.has("k0844_long_tail") && strings.has("k0845") && strings.has("k0846-x") && strings.has("k0847é") && strings.has("k0848日本") && strings.has("k0849_long_tail")) hits++;
    if (strings.has("k0850") && strings.has("k0851-x") && strings.has("k0852é") && strings.has("k0853日本") && strings.has("k0854_long_tail") && strings.has("k0855") && strings.has("k0856-x") && strings.has("k0857é") && strings.has("k0858日本") && strings.has("k0859_long_tail") && strings.has("k0860") && strings.has("k0861-x") && strings.has("k0862é") && strings.has("k0863日本") && strings.has("k0864_long_tail") && strings.has("k0865") && strings.has("k0866-x") && strings.has("k0867é") && strings.has("k0868日本") && strings.has("k0869_long_tail") && strings.has("k0870") && strings.has("k0871-x") && strings.has("k0872é") && strings.has("k0873日本") && strings.has("k0874_long_tail")) hits++;
    if (strings.has("k0875") && strings.has("k0876-x") && strings.has("k0877é") && strings.has("k0878日本") && strings.has("k0879_long_tail") && strings.has("k0880") && strings.has("k0881-x") && strings.has("k0882é") && strings.has("k0883日本") && strings.has("k0884_long_tail") && strings.has("k0885") && strings.has("k0886-x") && strings.has("k0887é") && strings.has("k0888日本") && strings.has("k0889_long_tail") && strings.has("k0890") && strings.has("k0891-x") && strings.has("k0892é") && strings.has("k0893日本") && strings.has("k0894_long_tail") && strings.has("k0895") && strings.has("k0896-x") && strings.has("k0897é") && strings.has("k0898日本") && strings.has("k0899_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0800?")) hits -= 1000;
    strings.add("k0800").add("k0899_long_tail");
  }
  return hits;
}
function group09(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k0900") && strings.has("k0901-x") && strings.has("k0902é") && strings.has("k0903日本") && strings.has("k0904_long_tail") && strings.has("k0905") && strings.has("k0906-x") && strings.has("k0907é") && strings.has("k0908日本") && strings.has("k0909_long_tail") && strings.has("k0910") && strings.has("k0911-x") && strings.has("k0912é") && strings.has("k0913日本") && strings.has("k0914_long_tail") && strings.has("k0915") && strings.has("k0916-x") && strings.has("k0917é") && strings.has("k0918日本") && strings.has("k0919_long_tail") && strings.has("k0920") && strings.has("k0921-x") && strings.has("k0922é") && strings.has("k0923日本") && strings.has("k0924_long_tail")) hits++;
    if (strings.has("k0925") && strings.has("k0926-x") && strings.has("k0927é") && strings.has("k0928日本") && strings.has("k0929_long_tail") && strings.has("k0930") && strings.has("k0931-x") && strings.has("k0932é") && strings.has("k0933日本") && strings.has("k0934_long_tail") && strings.has("k0935") && strings.has("k0936-x") && strings.has("k0937é") && strings.has("k0938日本") && strings.has("k0939_long_tail") && strings.has("k0940") && strings.has("k0941-x") && strings.has("k0942é") && strings.has("k0943日本") && strings.has("k0944_long_tail") && strings.has("k0945") && strings.has("k0946-x") && strings.has("k0947é") && strings.has("k0948日本") && strings.has("k0949_long_tail")) hits++;
    if (strings.has("k0950") && strings.has("k0951-x") && strings.has("k0952é") && strings.has("k0953日本") && strings.has("k0954_long_tail") && strings.has("k0955") && strings.has("k0956-x") && strings.has("k0957é") && strings.has("k0958日本") && strings.has("k0959_long_tail") && strings.has("k0960") && strings.has("k0961-x") && strings.has("k0962é") && strings.has("k0963日本") && strings.has("k0964_long_tail") && strings.has("k0965") && strings.has("k0966-x") && strings.has("k0967é") && strings.has("k0968日本") && strings.has("k0969_long_tail") && strings.has("k0970") && strings.has("k0971-x") && strings.has("k0972é") && strings.has("k0973日本") && strings.has("k0974_long_tail")) hits++;
    if (strings.has("k0975") && strings.has("k0976-x") && strings.has("k0977é") && strings.has("k0978日本") && strings.has("k0979_long_tail") && strings.has("k0980") && strings.has("k0981-x") && strings.has("k0982é") && strings.has("k0983日本") && strings.has("k0984_long_tail") && strings.has("k0985") && strings.has("k0986-x") && strings.has("k0987é") && strings.has("k0988日本") && strings.has("k0989_long_tail") && strings.has("k0990") && strings.has("k0991-x") && strings.has("k0992é") && strings.has("k0993日本") && strings.has("k0994_long_tail") && strings.has("k0995") && strings.has("k0996-x") && strings.has("k0997é") && strings.has("k0998日本") && strings.has("k0999_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k0900?")) hits -= 1000;
    strings.add("k0900").add("k0999_long_tail");`,
      [
        40,
        n => `  }
  return hits;
}
function group${n + 10}(strings: Set<string>, rounds: number): number {
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    if (strings.has("k${100 * n + 1000}") && strings.has("k${100 * n + 1001}-x") && strings.has("k${100 * n + 1002}é") && strings.has("k${100 * n + 1003}日本") && strings.has("k${100 * n + 1004}_long_tail") && strings.has("k${100 * n + 1005}") && strings.has("k${100 * n + 1006}-x") && strings.has("k${100 * n + 1007}é") && strings.has("k${100 * n + 1008}日本") && strings.has("k${100 * n + 1009}_long_tail") && strings.has("k${100 * n + 1010}") && strings.has("k${100 * n + 1011}-x") && strings.has("k${100 * n + 1012}é") && strings.has("k${100 * n + 1013}日本") && strings.has("k${100 * n + 1014}_long_tail") && strings.has("k${100 * n + 1015}") && strings.has("k${100 * n + 1016}-x") && strings.has("k${100 * n + 1017}é") && strings.has("k${100 * n + 1018}日本") && strings.has("k${100 * n + 1019}_long_tail") && strings.has("k${100 * n + 1020}") && strings.has("k${100 * n + 1021}-x") && strings.has("k${100 * n + 1022}é") && strings.has("k${100 * n + 1023}日本") && strings.has("k${100 * n + 1024}_long_tail")) hits++;
    if (strings.has("k${100 * n + 1025}") && strings.has("k${100 * n + 1026}-x") && strings.has("k${100 * n + 1027}é") && strings.has("k${100 * n + 1028}日本") && strings.has("k${100 * n + 1029}_long_tail") && strings.has("k${100 * n + 1030}") && strings.has("k${100 * n + 1031}-x") && strings.has("k${100 * n + 1032}é") && strings.has("k${100 * n + 1033}日本") && strings.has("k${100 * n + 1034}_long_tail") && strings.has("k${100 * n + 1035}") && strings.has("k${100 * n + 1036}-x") && strings.has("k${100 * n + 1037}é") && strings.has("k${100 * n + 1038}日本") && strings.has("k${100 * n + 1039}_long_tail") && strings.has("k${100 * n + 1040}") && strings.has("k${100 * n + 1041}-x") && strings.has("k${100 * n + 1042}é") && strings.has("k${100 * n + 1043}日本") && strings.has("k${100 * n + 1044}_long_tail") && strings.has("k${100 * n + 1045}") && strings.has("k${100 * n + 1046}-x") && strings.has("k${100 * n + 1047}é") && strings.has("k${100 * n + 1048}日本") && strings.has("k${100 * n + 1049}_long_tail")) hits++;
    if (strings.has("k${100 * n + 1050}") && strings.has("k${100 * n + 1051}-x") && strings.has("k${100 * n + 1052}é") && strings.has("k${100 * n + 1053}日本") && strings.has("k${100 * n + 1054}_long_tail") && strings.has("k${100 * n + 1055}") && strings.has("k${100 * n + 1056}-x") && strings.has("k${100 * n + 1057}é") && strings.has("k${100 * n + 1058}日本") && strings.has("k${100 * n + 1059}_long_tail") && strings.has("k${100 * n + 1060}") && strings.has("k${100 * n + 1061}-x") && strings.has("k${100 * n + 1062}é") && strings.has("k${100 * n + 1063}日本") && strings.has("k${100 * n + 1064}_long_tail") && strings.has("k${100 * n + 1065}") && strings.has("k${100 * n + 1066}-x") && strings.has("k${100 * n + 1067}é") && strings.has("k${100 * n + 1068}日本") && strings.has("k${100 * n + 1069}_long_tail") && strings.has("k${100 * n + 1070}") && strings.has("k${100 * n + 1071}-x") && strings.has("k${100 * n + 1072}é") && strings.has("k${100 * n + 1073}日本") && strings.has("k${100 * n + 1074}_long_tail")) hits++;
    if (strings.has("k${100 * n + 1075}") && strings.has("k${100 * n + 1076}-x") && strings.has("k${100 * n + 1077}é") && strings.has("k${100 * n + 1078}日本") && strings.has("k${100 * n + 1079}_long_tail") && strings.has("k${100 * n + 1080}") && strings.has("k${100 * n + 1081}-x") && strings.has("k${100 * n + 1082}é") && strings.has("k${100 * n + 1083}日本") && strings.has("k${100 * n + 1084}_long_tail") && strings.has("k${100 * n + 1085}") && strings.has("k${100 * n + 1086}-x") && strings.has("k${100 * n + 1087}é") && strings.has("k${100 * n + 1088}日本") && strings.has("k${100 * n + 1089}_long_tail") && strings.has("k${100 * n + 1090}") && strings.has("k${100 * n + 1091}-x") && strings.has("k${100 * n + 1092}é") && strings.has("k${100 * n + 1093}日本") && strings.has("k${100 * n + 1094}_long_tail") && strings.has("k${100 * n + 1095}") && strings.has("k${100 * n + 1096}-x") && strings.has("k${100 * n + 1097}é") && strings.has("k${100 * n + 1098}日本") && strings.has("k${100 * n + 1099}_long_tail")) hits++;
    if (strings.has("often0") && strings.has("often1") && strings.has("often2") && strings.has("often3") && strings.has("often4") && strings.has("often5") && strings.has("often6") && strings.has("often7") && strings.has("") && strings.has("a") && strings.has("é") && strings.has("日")) hits++;
    if (strings.has("k${100 * n + 1000}?")) hits -= 1000;
    strings.add("k${100 * n + 1000}").add("k${100 * n + 1099}_long_tail");`,
      ],
      `  }
  return hits;
}

let hits = 0;
for (let pass = 0; pass < 3; pass++) {
  hits += group00(seen, 100) + group01(seen, 100) + group02(seen, 100) + group03(seen, 100) + group04(seen, 100) + group05(seen, 100) + group06(seen, 100) + group07(seen, 100) + group08(seen, 100) + group09(seen, 100);
  hits += group10(seen, 100) + group11(seen, 100) + group12(seen, 100) + group13(seen, 100) + group14(seen, 100) + group15(seen, 100) + group16(seen, 100) + group17(seen, 100) + group18(seen, 100) + group19(seen, 100);
  hits += group20(seen, 100) + group21(seen, 100) + group22(seen, 100) + group23(seen, 100) + group24(seen, 100) + group25(seen, 100) + group26(seen, 100) + group27(seen, 100) + group28(seen, 100) + group29(seen, 100);
  hits += group30(seen, 100) + group31(seen, 100) + group32(seen, 100) + group33(seen, 100) + group34(seen, 100) + group35(seen, 100) + group36(seen, 100) + group37(seen, 100) + group38(seen, 100) + group39(seen, 100);
  hits += group40(seen, 100) + group41(seen, 100) + group42(seen, 100) + group43(seen, 100) + group44(seen, 100) + group45(seen, 100) + group46(seen, 100) + group47(seen, 100) + group48(seen, 100) + group49(seen, 100);
  Bun.gc(true);
}
console.log(hits, seen.size);

let checksum = 0;
for (const text of seen) {
  for (let i = 0; i < text.length; i++) checksum = (checksum * 31 + text.charCodeAt(i)) | 0;
}
console.log(checksum);
`,
    ),
  });
