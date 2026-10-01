// Go's regexp in the syntax of JavaScript: the classes, and the source that each regexp of the runner that ports one of Go must have.
// verify_go.ts proves the classes for every scalar value and the composed regexps on vectors of Go; regex_sites.ts holds the runner to the sources.
export const SPACE = "[\\t\\n\\f\\r ]";
export const NOT_SPACE = "[^\\t\\n\\f\\r ]";
export const WORD = "[0-9A-Za-z_]";
export const DIGIT = "[0-9]";
export const DOT = "[^\\n]";
export const LINE_START = "(?<![^\\n])";
export const LINE_END = "(?![^\\n])";

const S = SPACE;
// test_case_parser.go:41 and :44. On one line, which holds no LF, (?m)^ is ^; on a whole text it is LINE_START.
export const optionRegexLine = `^\\/{2}${S}*@(${WORD}+)${S}*:${S}*([^\\r\\n]*)`;
export const linkRegexLine = `^\\/{2}${S}*@link${S}*:${S}*([^\\r\\n]*)${S}*->${S}*([^\\r\\n]*)`;
export const optionRegexText = LINE_START + optionRegexLine.slice(1);
// compiler_runner.go:30
export const referencesRegex = `reference${S}path`;
// error_baseline.go:31 and :32 on a byte string. Under (?i) the letter s is s, S or U+017F (the bytes c5 bf); l, i, b, d and t have two forms each.
const lib = `([lL][iI][bB]${DOT}*\\.[dD]\\.[tT](?:[sS]|\\xc5\\xbf))`;
export const diagnosticsLocationPrefixGo = `${LINE_START}${lib}\\(\\d+,\\d+\\)`;
export const diagnosticsLocationPatternGo = `${lib}:\\d+:\\d+`;
// No regexp of Go: the line of tildes that the reader accepts, after the prefix that error_baseline.go:216 writes with `\S` replaced.
export const squigglePattern = `^${S}*~*$`;

// Where the runner has them: [file below runner/, name of the constant or the text before the literal, source, flags].
export const sites: [file: string, before: string, source: string, flags: string][] = [
  ["test_case_parser.ts", "const optionRegexLine = ", optionRegexLine, ""],
  ["test_case_parser.ts", "const linkRegexLine = ", linkRegexLine, ""],
  ["test_case_parser.ts", "const optionRegexText = ", optionRegexText, "g"],
  ["compiler_test.ts", "const referencesRegex = ", referencesRegex, ""],
  ["error_baseline.ts", "export const diagnosticsLocationPrefixGo =\n  ", diagnosticsLocationPrefixGo, "g"],
  ["error_baseline.ts", "const diagnosticsLocationPatternGo = ", diagnosticsLocationPatternGo, "g"],
  ["text_model.ts", "  squigglePattern: ", squigglePattern, ""],
];
