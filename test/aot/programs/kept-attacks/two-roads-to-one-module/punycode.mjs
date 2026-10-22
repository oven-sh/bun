// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:punycode";
import whole from "node:punycode";
import { decode as named_decode, encode as named_encode, toASCII as named_toASCII, toUnicode as named_toUnicode, ucs2 as named_ucs2, version as named_version } from "node:punycode";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:punycode");
const asked = process.getBuiltinModule("node:punycode");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("decode", named_decode === space.decode, named_decode === whole.decode, named_decode === required.decode, named_decode === asked.decode, space.decode === required.decode, whole.decode === required.decode, asked.decode === required.decode, whole.decode === space.decode);
same("encode", named_encode === space.encode, named_encode === whole.encode, named_encode === required.encode, named_encode === asked.encode, space.encode === required.encode, whole.encode === required.encode, asked.encode === required.encode, whole.encode === space.encode);
same("toASCII", named_toASCII === space.toASCII, named_toASCII === whole.toASCII, named_toASCII === required.toASCII, named_toASCII === asked.toASCII, space.toASCII === required.toASCII, whole.toASCII === required.toASCII, asked.toASCII === required.toASCII, whole.toASCII === space.toASCII);
same("toUnicode", named_toUnicode === space.toUnicode, named_toUnicode === whole.toUnicode, named_toUnicode === required.toUnicode, named_toUnicode === asked.toUnicode, space.toUnicode === required.toUnicode, whole.toUnicode === required.toUnicode, asked.toUnicode === required.toUnicode, whole.toUnicode === space.toUnicode);
same("ucs2", named_ucs2 === space.ucs2, named_ucs2 === whole.ucs2, named_ucs2 === required.ucs2, named_ucs2 === asked.ucs2, space.ucs2 === required.ucs2, whole.ucs2 === required.ucs2, asked.ucs2 === required.ucs2, whole.ucs2 === space.ucs2);
same("version", named_version === space.version, named_version === whole.version, named_version === required.version, named_version === asked.version, space.version === required.version, whole.version === required.version, asked.version === required.version, whole.version === space.version);
