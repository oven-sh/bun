// path.startsWith(directory + "/") and path.endsWith("." + extension): the string asked about is put together in the call.
// Its parts are asked about one after the other. Each of the 60,000 tests in the long loop once made a string and called the run time to flatten it.
// COUNT: operation:operationAOTStringHasAt <= 1000
const log = [];
const show = (label, value) => log.push(label + ": " + value);

function isBelow(path, directory) { return path.startsWith(directory + "/"); }
function isBelowByTemplate(path, directory) { return path.startsWith(`${directory}/`); }
function hasExtension(path, extension) { return path.endsWith("." + extension); }
function isNamed(path, name, extension) { return path.endsWith(name + "." + extension); }
function isWrapped(text, open, name, close) { return text.startsWith(open + name + close); }
function returnsTheTest(path, a, b) { return path.startsWith(a + b); }

const paths = ["/a/b/c.ts", "/a/b", "/a/b/", "/a/bc/d.ts", "", "/", "/a", "/a/b/c.tsx", "é/中/c.ts", "/a/b/中.ts"];
const directories = ["/a/b", "/a", "", "/", "/a/b/c.ts", "/a/b/c.ts/more", "é/中", "é"];
for (const path of paths) {
    for (const directory of directories)
        show(`below ${path} ${directory}`, [isBelow(path, directory), isBelowByTemplate(path, directory), returnsTheTest(path, directory, "/"), returnsTheTest(path, "", directory), returnsTheTest(path, directory, "")]);
    for (const extension of ["ts", "tsx", "", "s", "c.ts", "/a/b/c.ts", "中.ts"])
        show(`extension ${path} ${extension}`, [hasExtension(path, extension), isNamed(path, "c", extension), isNamed(path, "", extension), isNamed(path, "中", extension)]);
}
show("wrapped", [isWrapped("<b>x", "<", "b", ">"), isWrapped("<b", "<", "b", ">"), isWrapped("<bb>", "<", "b", ">"), isWrapped("", "", "", ""), isWrapped("<b>", "<", "b>", "")]);

// Parts that are not strings are converted as the concatenation converts them.
const list = ["a", "b"];
function withElement(text, i) { return text.startsWith(list[i] + ":"); }
show("element", [withElement("a:1", 0), withElement("b:1", 0), withElement("undefined:1", 5), withElement("undefined", 5), withElement("a:1", 5)]);
function withNumber(text, n) { return [text.startsWith("v" + n + "."), text.endsWith("-" + n), text.startsWith(n + "px"), text.endsWith(`#${n}`)]; }
for (const n of [0, 1, 12, -1, 1.5, -0, NaN, Infinity, 1e21, 1e-7, 4294967296])
    show(`number ${n}`, [withNumber("v" + n + ".x-" + n, n), withNumber(n + "px #" + n, n), withNumber("v1.x-12", n)]);
function withAnything(text, value) { return [text.startsWith("(" + value + ")"), text.endsWith("=" + value)]; }
for (const value of [undefined, null, true, false, 10n, "s", ""])
    show(`value ${String(value)}`, [withAnything("(" + value + ")=" + value, value), withAnything("()=", value)]);
function addsNumbersFirst(text, a, b) { return text.startsWith(a + b + "!"); }
show("numbers are added first", [addsNumbersFirst("3!", 1, 2), addsNumbersFirst("12!", 1, 2), addsNumbersFirst("12!", "1", 2)]);

// An object among the parts runs its code once, in order, whatever the answer is.
function withObject(text, object) { return text.startsWith("[" + object + "]"); }
let conversions = 0;
const counted = { toString() { conversions++; return "o"; } };
show("object", [withObject("[o]", counted), withObject("x", counted), withObject("", counted), conversions]);
function withSymbol(text, symbol) { try { return text.startsWith("a" + symbol); } catch (error) { return error.constructor.name; } }
show("symbol", [withSymbol("a", Symbol()), withSymbol("b", Symbol.iterator)]);

// Parts that are put together themselves, read once or more than once.
function withRopes(text, a, b, c) { const head = a + b; return [text.startsWith(head + c), text.endsWith(head + c), head.length, text.startsWith((a + b) + (b + c)), text.endsWith(a + (b + (c + a)))]; }
show("ropes", [withRopes("xyz", "x", "y", "z"), withRopes("xyyz", "x", "y", "z"), withRopes("xyzx", "x", "y", "z"), withRopes("", "", "", "")]);
const long = "0123456789abcdef".repeat(8);
show("long parts", [isBelow(long + "/x", long), isBelow(long + "x", long), isBelow(long, long), isNamed("/" + long + "." + long, long, long), isNamed(long + long, long, long)]);

// The receiver may be put together too, and a position is as before.
function ofRope(a, b, c) { return (a + b).startsWith(a + c); }
show("receiver", [ofRope("ab", "cd", "c"), ofRope("ab", "cd", "d"), ofRope("", "", "")]);
function withPosition(text, a, b, position) { return [text.startsWith(a + b, position), text.endsWith(a + b, position)]; }
show("position", [withPosition("xxab", "a", "b", 2), withPosition("abxx", "a", "b", 2), withPosition("ab", "a", "b", -1), withPosition("ab", "a", "b", undefined), withPosition("ab", "a", "b", 9)]);

// A string longer than any string may be is not made: the concatenation throws, also where the answer would be false.
let half = "x";
for (let i = 0; i < 30; i++) half += half; // 2 ** 30 characters, a rope
function tooLong(text, a, b, c) {
    try { return text.startsWith(a + b + c); } catch (error) { return error.constructor.name + " in the function"; }
}
function tooLongAtEnd(text, a, b) { return text.endsWith(a + b); }
show("too long", [tooLong("y", half, half, ""), tooLong("", half, "", half), tooLong("x", "x", half, half), tooLong("y", half, half, 1), tooLong("y", half, undefined, half)]);
try { show("too long at the end", tooLongAtEnd("y", half, half)); } catch (error) { show("too long at the end", error.constructor.name + " in the caller"); }
function countsFirst(text, a, b) { let n = 0; try { n++; const answer = text.startsWith(a + b); n++; return [answer, n]; } catch { return ["threw", n]; } }
show("what ran in front of it", [countsFirst("y", half, half), countsFirst("xy", "x", "y")]);

// In loops and callbacks.
const roots = ["/usr", "/home/me", "/tmp"];
show("some", ["/home/me/x", "/home/mex", "/tmp", "/tmp/", "/usr/lib"].map(path => roots.some(root => path.startsWith(root + "/"))));
show("filter", roots.filter(root => "/home/me/x/usr".endsWith("/x" + root)));
let found = 0;
for (let round = 0; round < 20000; round++) for (const root of roots) if ("/home/me/file".startsWith(root + "/")) found++;
show("many", found);

console.log(log.join("\n"));
