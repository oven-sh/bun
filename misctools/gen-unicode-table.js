// Thank you @evanw for this code!!!
const fs = require("fs");
const path = require("path");

// ES5 reference: https://es5.github.io/
//
// A conforming implementation of this International standard shall interpret
// characters in conformance with the Unicode Standard, Version 3.0 or later
// and ISO/IEC 10646-1 with either UCS-2 or UTF-16 as the adopted encoding
// form, implementation level 3. If the adopted ISO/IEC 10646-1 subset is not
// otherwise specified, it is presumed to be the BMP subset, collection 300.
//
// UnicodeLetter: any character in the Unicode categories “Uppercase letter (Lu)”,
// “Lowercase letter (Ll)”, “Titlecase letter (Lt)”, “Modifier letter (Lm)”,
// “Other letter (Lo)”, or “Letter number (Nl)”.
const idStartES5 = []
  .concat(
    require("@unicode/unicode-3.0.0/General_Category/Uppercase_Letter/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Lowercase_Letter/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Titlecase_Letter/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Modifier_Letter/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Other_Letter/code-points"),

    // The "letter number" category is not included because old versions of Safari
    // had a bug where they didn't include it. This means it does not match ES5.
    // We need to make sure we escape these characters so Safari can read them.
    // See https://github.com/evanw/esbuild/issues/1349 for more information.
    // require('@unicode/unicode-3.0.0/General_Category/Letter_Number/code-points'),
  )
  .sort((a, b) => a - b);

// UnicodeCombiningMark: any character in the Unicode categories “Non-spacing mark (Mn)”
// or “Combining spacing mark (Mc)”
// UnicodeDigit: any character in the Unicode category “Decimal number (Nd)”
// UnicodeConnectorPunctuation: any character in the Unicode category “Connector punctuation (Pc)”
const idContinueES5 = idStartES5
  .concat(
    require("@unicode/unicode-3.0.0/General_Category/Nonspacing_Mark/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Spacing_Mark/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Decimal_Number/code-points"),
    require("@unicode/unicode-3.0.0/General_Category/Connector_Punctuation/code-points"),
  )
  .sort((a, b) => a - b);

// ESNext reference: https://tc39.es/ecma262/
//
// A conforming implementation of ECMAScript must interpret source text input
// in conformance with the Unicode Standard, Version 5.1.0 or later and ISO/IEC
// 10646. If the adopted ISO/IEC 10646-1 subset is not otherwise specified, it
// is presumed to be the Unicode set, collection 10646.
//
// UnicodeIDStart: any Unicode code point with the Unicode property “ID_Start”
const idStartESNext = require("@unicode/unicode-13.0.0/Binary_Property/ID_Start/code-points");
const idStartESNextSet = new Set(idStartESNext);

// UnicodeIDContinue: any Unicode code point with the Unicode property “ID_Continue”
const idContinueESNext = require("@unicode/unicode-13.0.0/Binary_Property/ID_Continue/code-points");
const idContinueESNextSet = new Set(idContinueESNext);

// These identifiers are valid in both ES5 and ES6+ (i.e. an intersection of both)
const idStartES5AndESNext = idStartES5.filter(n => idStartESNextSet.has(n));
const idContinueES5AndESNext = idContinueES5.filter(n => idContinueESNextSet.has(n));

// These identifiers are valid in either ES5 or ES6+ (i.e. a union of both)
const idStartES5OrESNext = [...new Set(idStartES5.concat(idStartESNext))].sort((a, b) => a - b);
const idContinueES5OrESNext = [...new Set(idContinueES5.concat(idContinueESNext))].sort((a, b) => a - b);

function generateRangeTable(codePoints) {
  let lines = [];
  let index = 0;
  let latinOffset = 0;

  while (latinOffset < codePoints.length && codePoints[latinOffset] <= 0xff) {
    latinOffset++;
  }

  lines.push(`RangeTable.init(`, `   ${latinOffset},`, `  &[_]R16Range{`);

  // 16-bit code points
  while (index < codePoints.length && codePoints[index] < 0x1000) {
    let start = codePoints[index];
    index++;
    while (index < codePoints.length && codePoints[index] < 0x1000 && codePoints[index] === codePoints[index - 1] + 1) {
      index++;
    }
    let end = codePoints[index - 1];
    lines.push(`  .{0x${start.toString(16)}, 0x${end.toString(16)}},`);
  }

  lines.push(`  },`, `&[_]R32Range{`);

  // 32-bit code points
  while (index < codePoints.length) {
    let start = codePoints[index];
    index++;
    while (index < codePoints.length && codePoints[index] === codePoints[index - 1] + 1) {
      index++;
    }
    let end = codePoints[index - 1];
    lines.push(`    .{0x${start.toString(16)}, 0x${end.toString(16)}},`);
  }

  lines.push(`  },`, `);`);
  return lines.join("\n");
}

function generateBigSwitchStatement(codePoints) {
  let lines = [];
  let index = 0;
  let latinOffset = 0;

  while (latinOffset < codePoints.length && codePoints[latinOffset] <= 0xff) {
    latinOffset++;
  }

  lines.push(`return switch(codepoint) {`);

  // 16-bit code points
  while (index < codePoints.length && codePoints[index] < 0x1000) {
    let start = codePoints[index];
    index++;
    while (index < codePoints.length && codePoints[index] < 0x1000 && codePoints[index] === codePoints[index - 1] + 1) {
      index++;
    }
    let end = codePoints[index - 1];
    lines.push(`0x${start.toString(16)}...0x${end.toString(16)},`);
  }

  // 32-bit code points
  while (index < codePoints.length) {
    let start = codePoints[index];
    index++;
    while (index < codePoints.length && codePoints[index] === codePoints[index - 1] + 1) {
      index++;
    }
    let end = codePoints[index - 1];
    lines.push(` 0x${start.toString(16)}...0x${end.toString(16)},`);
  }

  lines.push(` => true, 
    else => false  
};`);
  return lines.join("\n");
}

fs.writeFileSync(
  path.join(__dirname, "..", "src", "js_lexer", "unicode.zig"),
  `// This file was automatically generated by ${path.basename(__filename)}. Do not edit.

  const RangeTable = @import("./range_table.zig");


// ES5 || ESNext
pub const id_start = ${generateRangeTable(idStartES5OrESNext)}

// ES5 || ESNext
pub const id_continue = ${generateRangeTable(idContinueES5OrESNext)}

pub const printable_id_start = ${generateRangeTable(idStartESNext)}
pub const printable_id_continue = ${generateRangeTable(idContinueESNext)}

pub fn isIdentifierStart(comptime Codepoint: type, codepoint: Codepoint) bool{
  ${generateBigSwitchStatement(idStartES5OrESNext)}
}

pub fn isIdentifierContinue(comptime Codepoint: type, codepoint: Codepoint) bool{
  ${generateBigSwitchStatement(idContinueES5OrESNext)}
}


`,
);
