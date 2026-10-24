// The strings array of a tagged template: frozen, with its `raw` property (the same program without type annotations).
const t = (s, ...v) => JSON.stringify([Array.from(s, x => x === undefined ? "UNDEFINED" : x), s.raw, v]);
console.log("none", t`\unicode`);
console.log("none", t`\u{110000}`);
console.log("none", t`\xg`);
console.log("none", t`\01`);
console.log("none", t`\00`);
console.log("none", t`\09`);
console.log("none", t`\8`);
console.log("none", t`\u12`);
console.log("none", t`\u{`);
console.log("none", t`\u{}`);
console.log("none", t`\u{g}`);
console.log("none", t`\xA`);
console.log("none", t`\u{41`);
console.log("none", t`\9`);
console.log("none", t`\x`);
console.log("none", t`\u`);
console.log("none", t`\u{FFFFFFFFFF}`);
console.log("none", t`\u004`);
console.log("none", t`\1a`);
console.log("fine", t`\0`);
console.log("fine", t`\0a`);
console.log("fine", t`\x41`);
console.log("fine", t`\u0041`);
console.log("fine", t`\u{41}`);
console.log("fine", t`\u{10FFFF}`);
console.log("fine", t`\u{0000000041}`);
console.log("fine", t`\\x`);
console.log("fine", t`\\u`);
console.log("fine", t`\\8`);
console.log("fine", t`\\\\xg`);
console.log("fine", t`\n\t`);
console.log("fine", t`\``);
console.log("fine", t`\$`);
console.log("fine", t`\${1}`);
console.log("fine", t`$`);
console.log("fine", t`$$`);
console.log("fine", t`\a`);
console.log("fine", t`\\`);
console.log("piece", t`a${1}\xg${2}b`, t`\u${1}ok`, t`ok${1}\8`, t`\x41${1}\x4`);
console.log('bs cr', t`a\
b`, JSON.stringify(String.raw`a\
b`));
console.log('bs crlf', t`a\
b`, JSON.stringify(String.raw`a\
b`));
console.log('cr', t`a
b`, JSON.stringify(String.raw`a
b`));
console.log('crlf', t`a
b`, JSON.stringify(String.raw`a
b`));
console.log('bs lf', t`a\
b`, JSON.stringify(String.raw`a\
b`));
console.log('crcr', t`a

b`, JSON.stringify(String.raw`a

b`));
console.log('bs bs cr', t`a\\
b`, JSON.stringify(String.raw`a\\
b`));
console.log('cr at end', t`a\
`, JSON.stringify(String.raw`a\
`));
console.log('cr piece', t`a\
${1}\
b`, JSON.stringify(String.raw`a\
${1}\
b`));
console.log('block', t`A${1 /* } */}B`, JSON.stringify(String.raw`A${1 /* } */}B`));
console.log('line', t`A${1 // }
}B`, JSON.stringify(String.raw`A${1 // }
}B`));
console.log('twice', t`A${1 /* } */ /* } */}B`, JSON.stringify(String.raw`A${1 /* } */ /* } */}B`));
console.log('paren', t`A${(1 /* } */)}B`, JSON.stringify(String.raw`A${(1 /* } */)}B`));
console.log('tick', t`A${1 /* ` */}B`, JSON.stringify(String.raw`A${1 /* ` */}B`));
console.log('string', t`A${"}"}B`, JSON.stringify(String.raw`A${"}"}B`));
console.log('object', t`A${{ a: 1 }.a}B`, JSON.stringify(String.raw`A${{ a: 1 }.a}B`));
console.log('arrow', t`A${(() => { return 1; })()}B`, JSON.stringify(String.raw`A${(() => { return 1; })()}B`));
console.log('nested', t`A${`}`}B`, JSON.stringify(String.raw`A${`}`}B`));
console.log('nested2', t`A${`x${1 /* } */}y`}B`, JSON.stringify(String.raw`A${`x${1 /* } */}y`}B`));
console.log('before', t`A${/* } */ 1}B`, JSON.stringify(String.raw`A${/* } */ 1}B`));
console.log('two', t`A${1 /* } */}B${2 // }
}C`, JSON.stringify(String.raw`A${1 /* } */}B${2 // }
}C`));
console.log('star', t`A${1 /* * / } */}B`, JSON.stringify(String.raw`A${1 /* * / } */}B`));
console.log('slash', t`A${4 / 2 /* } */}B`, JSON.stringify(String.raw`A${4 / 2 /* } */}B`));
console.log('regex', t`A${/}/.source}B`, JSON.stringify(String.raw`A${/}/.source}B`));
console.log('line cr', t`A${1 // }
}B`, JSON.stringify(String.raw`A${1 // }
}B`));
console.log('empty', t`${1 /* } */}`, JSON.stringify(String.raw`${1 /* } */}`));
