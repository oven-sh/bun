// Synthetic inputs, one per behaviour. Bytes are what is on disk.
const u8 = (s: string) => Buffer.from(s, "utf8");
const u16le = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
const u16be = (s: string) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, "utf16le").swap16()]);
export interface In { name: string; fileName: string; bytes: Buffer; allowImplicitFirstFile?: boolean }
const f = "/cases/compiler/synthetic.ts";
export const inputs: In[] = [
  // the reference's own test
  { name: "reference test", fileName: "simpleTest.ts", bytes: u8('// @strict: true\n// @noEmit: true\n// @filename: firstFile.ts\nfunction foo() { return "a"; }\n// normal comment\n// @filename: secondFile.ts\n// some other comment\nfunction bar() { return "b"; }') },
  // whitespace class
  { name: "ws: NBSP between slashes and at-sign", fileName: f, bytes: u8("//\u00a0@filename: a.ts\nx") },
  { name: "ws: VT between slashes and at-sign", fileName: f, bytes: u8("//\v@strict: true\nx") },
  { name: "ws: FF and TAB are in the class", fileName: f, bytes: u8("//\f\t@strict\t:\ftrue\nx") },
  { name: "ws: U+FEFF before at-sign", fileName: f, bytes: u8("//\ufeff@strict: true\nx") },
  { name: "ws: U+2028 inside directive", fileName: f, bytes: u8("//\u2028@strict: true\nx") },
  { name: "ws: U+3000 before colon", fileName: f, bytes: u8("// @strict\u3000: true\nx") },
  // word class
  { name: "word: non-ascii letter in name", fileName: f, bytes: u8("// @stri\u00e9ct: true\nx") },
  { name: "word: long s and kelvin", fileName: f, bytes: u8("// @\u017ftrict: 1\n// @\u212a: 2\nx") },
  { name: "word: digits and underscore", fileName: f, bytes: u8("// @_a1_B: v\nx") },
  { name: "word: dot ends the name", fileName: f, bytes: u8("// @a.b: c\nx") },
  { name: "word: upper case name is lowered", fileName: f, bytes: u8("// @FileName: A.ts\n// @NoEmit: TRUE\nx") },
  { name: "word: proto and constructor as names", fileName: f, bytes: u8("// @__proto__: p\n// @constructor: c\n// @toString: t\nx") },
  // anchors
  { name: "anchor: lone CR before directive", fileName: f, bytes: u8("x\r// @filename: a.ts\ny") },
  { name: "anchor: U+2028 before directive", fileName: f, bytes: u8("x\u2028// @strict: true\ny") },
  { name: "anchor: U+2029 before directive", fileName: f, bytes: u8("x\u2029// @strict: true\ny") },
  { name: "anchor: leading spaces", fileName: f, bytes: u8("  // @filename: a.ts\nx") },
  { name: "anchor: four slashes", fileName: f, bytes: u8("//// @filename: a.ts\nx") },
  { name: "anchor: three slashes", fileName: f, bytes: u8("/// @filename: a.ts\nx") },
  { name: "anchor: directive after code on the line", fileName: f, bytes: u8("var x; // @strict: true\ny") },
  // whole content against one line
  { name: "span: value on the next line", fileName: f, bytes: u8("// @target:\nvar x = 1;\n") },
  { name: "span: value after CRLF and blank lines", fileName: f, bytes: u8("// @target:\r\n\r\n  es5 ;\r\nvar x;") },
  { name: "span: at-sign on the next line", fileName: f, bytes: u8("//\n@strict: true\nx") },
  { name: "span: colon on the next line", fileName: f, bytes: u8("// @strict\n: true\nx") },
  { name: "span: directive swallowed by an empty one", fileName: f, bytes: u8("// @a:\n// @b: 1\nx") },
  // values
  { name: "value: one trailing semicolon trimmed in settings only", fileName: f, bytes: u8("// @declaration: true;\n// @strict: true ;\n// @x: a;;\n// @y: ;\nz") },
  { name: "value: trailing comment kept", fileName: f, bytes: u8("// @strict: true // why\nx") },
  { name: "value: lone CR ends the value", fileName: f, bytes: u8("// @noEmit: true\rrest\n// @filename: a.ts\rrest\nx") },
  { name: "value: CR CR LF", fileName: f, bytes: u8("// @noEmit: true\r\r\nx\r\r\ny") },
  { name: "value: last occurrence wins", fileName: f, bytes: u8("// @target: es5\nx\n// @target: es2015\n// @TARGET: esnext\ny") },
  { name: "value: empty value", fileName: f, bytes: u8("// @strict:\n\nx") },
  { name: "value: no colon", fileName: f, bytes: u8("// @strict true\nx") },
  { name: "value: comma list with spaces", fileName: f, bytes: u8("// @target: es5 , es2015,, esnext\nx") },
  // TrimSpace
  { name: "trim: U+0085 is trimmed", fileName: f, bytes: u8("// @filename: a.ts\u0085\n// @strict:\u0085true\u0085\nx") },
  { name: "trim: U+FEFF is kept", fileName: f, bytes: u8("// @filename: \ufeffa.ts\ufeff\n// @strict: \ufefftrue\ufeff\nx") },
  { name: "trim: NBSP and U+2003 and U+3000 are trimmed", fileName: f, bytes: u8("// @filename: \u00a0\u2003a.ts\u3000\nx") },
  { name: "trim: U+200B and U+180E are kept", fileName: f, bytes: u8("// @filename: \u200ba.ts\u180e\nx") },
  { name: "trim: VT and FF are trimmed", fileName: f, bytes: u8("// @filename: \va.ts\f\nx") },
  // links
  { name: "link: simple", fileName: f, bytes: u8("// @link: /a -> /b\nx") },
  { name: "link: last arrow splits", fileName: f, bytes: u8("// @link: a -> b -> c\nx") },
  { name: "link: upper case is an option", fileName: f, bytes: u8("// @Link: a -> b\nx") },
  { name: "link: no arrow is an option", fileName: f, bytes: u8("// @link: a b\nx") },
  { name: "link: empty sides", fileName: f, bytes: u8("// @link: ->\n// @link:->x\nx") },
  { name: "link: no spaces", fileName: f, bytes: u8("//@link:a->b\nx") },
  { name: "link: later target wins", fileName: f, bytes: u8("// @link: a -> p\n// @link: b -> p\nx") },
  { name: "link: line is tried before options", fileName: f, bytes: u8("// @filename: a.ts\nx\n// @link: /a -> /b\ny\n// @filename: b.ts\nz") },
  { name: "link: arrow in a filename directive is not a link", fileName: f, bytes: u8("// @filename: a->b.ts\nx") },
  // symlink
  { name: "symlink: bound to the current file", fileName: f, bytes: u8("// @filename: /a.ts\n// @symlink: /x.ts, /y.ts,, \nvar a;\n// @filename: /b.ts\n// @symlink: /x.ts\nvar b;") },
  { name: "symlink: before any file is a global option", fileName: f, bytes: u8("// @symlink: /x.ts\n// @filename: /a.ts\nvar a;") },
  // current directory
  { name: "currentDirectory: last wins and no semicolon trim", fileName: f, bytes: u8("// @currentDirectory: /a;\n// @CurrentDirectory: /b;\nx") },
  // fourslash file options
  { name: "fourslash options are per file", fileName: f, bytes: u8("// @emitThisFile: true\n// @filename: a.ts\n// @noOpen: 1\nx\n// @filename: b.ts\ny") },
  // units
  { name: "units: no filename directive", fileName: "/cases/compiler/dir/single.ts", bytes: u8("var x;\n") },
  { name: "units: no filename directive, backslash path", fileName: "c:\\cases\\single.tsx", bytes: u8("var x;") },
  { name: "units: leading blank lines vanish", fileName: f, bytes: u8("\n\n\r\n// @strict: true\n\n\nvar x;\n\nvar y;\n\n") },
  { name: "units: whitespace-only line is content", fileName: f, bytes: u8("\n \n\nvar x;") },
  { name: "units: blank lines between directive and content", fileName: f, bytes: u8("// @filename: a.ts\n\n\nvar a;\n\n// @filename: b.ts\n\nvar b;\n") },
  { name: "units: empty unit", fileName: f, bytes: u8("// @filename: a.ts\n// @filename: b.ts\nvar b;") },
  { name: "units: file ends with directive", fileName: f, bytes: u8("// @filename: a.ts\nvar a;\n// @filename: b.ts") },
  { name: "units: empty file", fileName: f, bytes: Buffer.alloc(0) },
  { name: "units: only newline", fileName: f, bytes: u8("\n") },
  { name: "units: duplicate names stay", fileName: f, bytes: u8("// @filename: a.ts\n1\n// @filename: a.ts\n2") },
  { name: "units: filename value with spaces and comment", fileName: f, bytes: u8("// @filename:   my file.ts  // note  \nx") },
  { name: "units: empty filename then filename", fileName: f, bytes: u8("// @filename:\n// c\n// @filename: b.ts\nx") },
  { name: "units: empty filename with code then filename", fileName: f, bytes: u8("// @filename:\nvar a;\n// @filename: b.ts\nx") },
  { name: "units: empty filename at the end", fileName: f, bytes: u8("// @filename: a.ts\nx\n// @filename:\ny") },
  { name: "units: only an empty filename", fileName: f, bytes: u8("// @filename:\ny") },
  { name: "units: lone CR stays in its line", fileName: f, bytes: u8("var a = `x\ry`;\r\nvar b;") },
  { name: "units: NUL byte", fileName: f, bytes: u8("// @filename: a.ts\nvar a = '\u0000';\n") },
  { name: "units: astral and U+2028 content", fileName: f, bytes: u8("// @filename: a.ts\nvar a = '\u{1f600}\u2028';\n") },
  // config unit
  { name: "config: first tsconfig is taken out", fileName: f, bytes: u8("// @filename: /a.ts\n1\n// @filename: /tsconfig.json\n{}\n// @filename: /sub/jsconfig.json\n{ }\n// @filename: /b.ts\n2") },
  { name: "config: case-insensitive base name, backslashes, trailing slash", fileName: f, bytes: u8("// @filename: c:\\x\\TSConfig.JSON\\\n{}\n// @filename: /b.ts\n2") },
  { name: "config: jsconfig only", fileName: f, bytes: u8("// @filename: jsconfig.json\n{}") },
  { name: "config: not a config name", fileName: f, bytes: u8("// @filename: tsconfig.base.json\n{}\n// @filename: /a/tsconfig.json.ts\n1") },
  { name: "config: dotted I lowers to i", fileName: f, bytes: u8("// @filename: /TSCONF\u0130G.JSON\n{}\n// @filename: /b.ts\n2") },
  { name: "config: url and unc roots", fileName: f, bytes: u8("// @filename: file:///c:/tsconfig.json\n{}\n// @filename: //server/tsconfig.json\n1\n// @filename: //server/share/jsconfig.json\n2") },
  // content before the first filename
  { name: "pre: comments and blank lines only", fileName: f, bytes: u8("// a comment\n\n  /* block\n comment */\t\n// @filename: a.ts\nx") },
  { name: "pre: code", fileName: f, bytes: u8("var early;\n// @filename: a.ts\nx") },
  { name: "pre: code after comment", fileName: f, bytes: u8("// c\n/* d */ var early;\n// @filename: a.ts\nx") },
  { name: "pre: unterminated block comment", fileName: f, bytes: u8("/* never closed\n// @filename: a.ts\nx") },
  { name: "pre: shebang", fileName: f, bytes: u8("#!/usr/bin/env node\n// c\n// @filename: a.ts\nx") },
  { name: "pre: shebang not at start", fileName: f, bytes: u8("// c\n#!/usr/bin/env node\n// @filename: a.ts\nx") },
  { name: "pre: conflict marker", fileName: f, bytes: u8("<<<<<<< HEAD\n// c\n// @filename: a.ts\nx") },
  { name: "pre: conflict markers with bodies", fileName: f, bytes: u8("// c\n<<<<<<< HEAD\nvar a;\n=======\nvar b;\n>>>>>>> other\n// @filename: a.ts\nx") },
  { name: "pre: bar conflict marker", fileName: f, bytes: u8("||||||| base\nvar a;\n=======\nvar b;\n>>>>>>> other\n// @filename: a.ts\nx") },
  { name: "pre: conflict marker two bytes after a line break", fileName: f, bytes: u8("// c\n  <<<<<<< HEAD\n// @filename: a.ts\nx") },
  { name: "pre: conflict marker after NBSP after a line break", fileName: f, bytes: u8("// c\n\u00a0<<<<<<< HEAD\n// @filename: a.ts\nx") },
  { name: "pre: conflict marker after two NBSP", fileName: f, bytes: u8("// c\n\u00a0\u00a0<<<<<<< HEAD\n// @filename: a.ts\nx") },
  { name: "pre: conflict marker after one space", fileName: f, bytes: u8("// c\n <<<<<<< HEAD\n// @filename: a.ts\nx") },
  { name: "pre: six less-than signs", fileName: f, bytes: u8("<<<<<< HEAD\n// @filename: a.ts\nx") },
  { name: "pre: equals marker at the very end", fileName: f, bytes: u8("// c\n=======\n// @filename: a.ts\nx") },
  { name: "pre: unicode white space", fileName: f, bytes: u8("\u00a0\u2003\u3000\ufeff\u0085\u200b\u2028\u2029// c\n// @filename: a.ts\nx") },
  { name: "pre: U+180E is not white space", fileName: f, bytes: u8("\u180e// c\n// @filename: a.ts\nx") },
  { name: "pre: star is not trivia", fileName: f, bytes: u8("/** doc\n */\n * x\n// @filename: a.ts\nx") },
  { name: "pre: lone slash", fileName: f, bytes: u8("/\n// @filename: a.ts\nx") },
  { name: "pre: comment with astral and U+2028", fileName: f, bytes: u8("// \u{1f600}\u2028// more\n// @filename: a.ts\nx") },
  { name: "pre: lone CR and CRLF", fileName: f, bytes: u8("// c\r// d\r\n\r\r\n// @filename: a.ts\nx") },
  { name: "pre: option lines do not count as content", fileName: f, bytes: u8("// @strict: true\n// @link: a -> b\n// @filename: a.ts\nx") },
  // decoding
  { name: "decode: utf-8 BOM", fileName: f, bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), u8("// @strict: true\nvar x;")]) },
  { name: "decode: two utf-8 BOMs", fileName: f, bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), u8("// @strict: true\nvar x;")]) },
  { name: "decode: utf-16 LE", fileName: f, bytes: u16le("// @strict: true\r\n// @filename: \u00e9.ts\r\nvar x = '\u{1f600}';\r\n") },
  { name: "decode: utf-16 BE", fileName: f, bytes: u16be("// @strict: true\r\n// @filename: \u00e9.ts\r\nvar x = '\u{1f600}';\r\n") },
  { name: "decode: utf-16 LE odd length", fileName: f, bytes: Buffer.concat([u16le("var x;"), Buffer.from([0x41])]) },
  { name: "decode: utf-16 LE lone surrogates", fileName: f, bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0x61, 0x00, 0x00, 0xd8, 0x62, 0x00, 0x00, 0xdc, 0x63, 0x00, 0x3d, 0xd8])]) },
  { name: "decode: utf-16 LE BOM only", fileName: f, bytes: Buffer.from([0xff, 0xfe]) },
  { name: "decode: utf-16 BE BOM and one byte", fileName: f, bytes: Buffer.from([0xfe, 0xff, 0x41]) },
  { name: "decode: utf-16 LE with inner BOM and NUL", fileName: f, bytes: u16le("\ufeffvar x = '\u0000';") },
  { name: "decode: utf-16 LE followed by utf-8 BOM bytes", fileName: f, bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0xef, 0xbb, 0xbf, 0x00])]) },
  { name: "decode: one byte 0xFF", fileName: f, bytes: Buffer.from([0xff]) },
  { name: "decode: two bytes of a utf-8 BOM", fileName: f, bytes: Buffer.from([0xef, 0xbb]) },
  { name: "decode: only a utf-8 BOM", fileName: f, bytes: Buffer.from([0xef, 0xbb, 0xbf]) },
  // fourslash branch
  { name: "implicit: content before first filename", fileName: "/fs/test.ts", allowImplicitFirstFile: true, bytes: u8("\n//// var a;\n\n// @filename: b.ts\n\n//// var b;\n") },
  { name: "implicit: empty first file is skipped", fileName: "/fs/test.ts", allowImplicitFirstFile: true, bytes: u8("// @strict: true\n// @filename: b.ts\n//// var b;") },
  { name: "implicit: no directive", fileName: "/fs/test.ts", allowImplicitFirstFile: true, bytes: u8("\n\n//// var a;") },
  { name: "implicit: symlink binds to the implicit file", fileName: "/fs/test.ts", allowImplicitFirstFile: true, bytes: u8("// @symlink: /l.ts\n//// var a;") },
];
if (import.meta.main) {
  const out = inputs.map(i => ({ name: i.name, fileName: i.fileName, bytes: i.bytes.toString("base64"), allowImplicitFirstFile: !!i.allowImplicitFirstFile }));
  await Bun.write(process.argv[2], JSON.stringify(out));
  console.error("inputs:", out.length);
}
