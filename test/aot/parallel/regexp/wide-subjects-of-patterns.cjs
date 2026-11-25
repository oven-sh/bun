// Patterns that match Latin-1 alone, over short wide strings and parts of them.
// COUNT: operationAOTRegExpTestBoxed <= 6000
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const contents = ["", "a", "abc", "abcdef", "fedcba", "abcdefg", "ABC", "x12", "12", "-moz-", "ÿ", "é", "aÿ", "abcÿdef", "name17", "a b", "\n", "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd", "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcde", "a".repeat(200), "名", "abc名", "名abc", "ab\ud83dc", "😀", "Ā", "abcdefĀ", "K", "ſ", "kK", "sſ", "—"];
let text = ""; const places = [];
for (const content of contents) { places.push([text.length, text.length + content.length]); text += content + "|"; }
text = JSON.parse(JSON.stringify(text + "—"));
const patterns = [/^[a-f]+$/, /[a-f]+/, /^-\w+-/, /\d+/, /^x(\d)(\d)$/, /[a-c]/i, /^$/, /c$/, /b(?=c)/, /é/, /ÿ/, /(a)(b)?(c)?/, /^[^a]+$/, /./, /\w\W?/, /k/i, /s/i, /[^\x00-\x7f]/, /name(\d+)/, /\s/, /a|b|z/, /abc$/, /^[\x00-\xff]*$/];
const test = (pattern, s) => pattern.test(s);
const first = (pattern, s) => { const match = pattern.exec(s); return match ? match.index + ":" + match.join("/") : "none"; };
const match = (pattern, s) => { const found = s.match(pattern); return found ? found.index + ":" + found.join("/") + found.input : "none"; };
const replace = (pattern, s) => s.replace(pattern, "<$&>");
const search = (pattern, s) => s.search(pattern);
const global = (pattern, s) => (s.match(new RegExp(pattern.source, pattern.flags + "g")) || []).join();
for (let round = 0; round < 20; ++round)
    for (let i = 0; i < contents.length; ++i) {
        const narrow = contents[i], part = text.slice(places[i][0], places[i][1]), whole = JSON.parse(JSON.stringify(contents[i] + "—")).slice(0, -1);
        for (let place = 0; place < patterns.length; ++place) {
            const pattern = patterns[place], name = pattern + " on " + i;
            const expected = test(pattern, narrow);
            check("test " + name, test(pattern, part), expected);
            check("test of whole " + name, test(pattern, whole), expected);
            check("test again " + name, test(pattern, part), expected);
            check("exec " + name, first(pattern, part), first(pattern, narrow));
            check("match " + name, match(pattern, part), match(pattern, narrow));
            check("search " + name, search(pattern, part), search(pattern, narrow));
            if (round === 0) { check("replace " + name, replace(pattern, part), replace(pattern, narrow)); check("global " + name, global(pattern, part), global(pattern, narrow)); }
        }
    }
const take = (pattern, s) => { if (pattern.test(s)) return RegExp.$1 + "," + RegExp.$2 + "," + RegExp.lastMatch + "," + RegExp.leftContext + "," + RegExp.rightContext; return "none"; };
const wide = JSON.parse(JSON.stringify("zx12y—"));
for (let i = 0; i < 100; ++i) check("last match", take(/x(\d)(\d)/, wide.slice(i % 2, 5)), "1,2,x12," + (i % 2 ? "" : "z") + ",y");
const count = (pattern, list) => { let found = 0; for (const s of list) if (pattern.test(s)) ++found; return found; };
const list = []; for (let i = 0; i < 4000; ++i) list.push(text.slice(places[i % 10][0], places[i % 10][1]));
check("count", count(/^[a-f]+$/, list), list.filter(s => contents.includes(s) && /^[a-f]+$/.test(s + "")).length);
console.log("ended", failures);
