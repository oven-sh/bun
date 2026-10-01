// Research scratch of "rules-static-evaluation" (top-down pass). Writes cases/td2-edge-for-direction.json: for-direction cases whose report
// depends on one static value each, so that the evaluation is seen from outside: `for (var i = 0; i < 10; i -= (E));` is
// reported exactly when E has a static value that is a number, a boolean or a BigInt above zero.
// usage: node gen-fd-values.cjs > ../cases/td2-edge-for-direction.json
"use strict";
const T = [ // expressions that are true in JavaScript
	// ToNumber of a string
	'+"1" === 1', '+"  12  " === 12', '+"" === 0', '+" " === 0', '+"\\n" === 0', '+"0x1F" === 31', '+"0b11" === 3', '+"0o17" === 15', '+"0X1f" === 31',
	'+"1e3" === 1000', '+".5" === 0.5', '+"5." === 5', '+"+5" === 5', '+"-5" === -5', '+"Infinity" === Infinity', '+"-Infinity" === -Infinity',
	'+"+Infinity" === Infinity', '+"abc" !== +"abc"', '+"1_0" !== +"1_0"', '+"0x" !== +"0x"', '+"1n" !== +"1n"', '+"-0x1" !== +"-0x1"',
	'+"infinity" !== +"infinity"', '+"1e" !== +"1e"', '+"." !== +"."', '+"\\u00a01\\ufeff" === 1', '+"\\u20281\\u2029" === 1', '+"1 2" !== +"1 2"',
	'+"\\u180e1" !== +"\\u180e1"', '+"\\u30001\\u1680" === 1', '+"1e1000" === Infinity', '+"-1e-1000" === 0', '1 / +"-0" === -Infinity', '+"00012" === 12',
	'+"1.5e+2" === 150', '+"1e-2" === 0.01', '+"0.1" + +"0.2" === 0.30000000000000004', '+"9007199254740993" === 9007199254740992',
	'+null === 0', '+undefined !== +undefined', '+true === 1', '+false === 0', '-"3" === -3', '~"5" === -6', '+`7` === 7',
	// typeof
	'typeof 1 === "number"', 'typeof 1n === "bigint"', 'typeof "" === "string"', 'typeof null === "object"', 'typeof undefined === "undefined"',
	'typeof void 0 === "undefined"', 'typeof true === "boolean"', 'typeof /a/ === "object"', 'typeof NaN === "number"', 'typeof typeof 1 === "string"',
	// ToString
	'`${1e21}` === "1e+21"', '`${1e-7}` === "1e-7"', '`${0.000001}` === "0.000001"', '`${-0}` === "0"', '`${123456789012345680000}` === "123456789012345680000"',
	'`${0.1 + 0.2}` === "0.30000000000000004"', '`${NaN}` === "NaN"', '`${-Infinity}` === "-Infinity"', '`${null}` === "null"', '`${undefined}` === "undefined"',
	'`${true}` === "true"', '`${10n}` === "10"', '`${-0x10n}` === "-16"', '`${/a/gi}` === "/a/gi"', '`${/a/ig}` === "/a/gi"', '`${/[/]\\//}` === "/[/]\\\\//"',
	'"" + 1.5 === "1.5"', '1 + "2" === "12"', '"3" + 4n === "34"', '1 + 2 + "3" === "33"', '"1" + null === "1null"', '"" + /x/ === "/x/"', '`a${1}b${"c"}` === "a1bc"',
	'`${1.0}` === "1"', '`${100}` === "100"', '`${1e300 * 10}` === "1e+301"', '`${5e-324}` === "5e-324"', '`${0xff}` === "255"', '`${1.7976931348623157e308}` === "1.7976931348623157e+308"',
	'`${4.35}` === "4.35"', '`${0.1 * 3}` === "0.30000000000000004"', '`${2 ** 53}` === "9007199254740992"', '`${-1e-7}` === "-1e-7"', '`${1e21 + 1}` === "1e+21"',
	// arithmetic
	'0.1 + 0.2 === 0.30000000000000004', '5 % 3 === 2', '-5 % 3 === -2', '5 % -3 === 2', '5.5 % 2 === 1.5', '1 / (-5 % 5) === -Infinity', '2 ** 10 === 1024',
	'2 ** -1 === 0.5', '(-8) ** (1 / 3) !== (-8) ** (1 / 3)', '1 ** Infinity !== 1 ** Infinity', '(-1) ** -Infinity !== (-1) ** -Infinity', 'NaN ** 0 === 1',
	'0 ** 0 === 1', '2 ** 3 ** 2 === 512', '7 / 2 === 3.5', '1 / 0 === Infinity', '"6" / "2" === 3', '"6" * "2" === 12', '"6" - "2" === 4', 'null + 1 === 1',
	'undefined + 1 !== undefined + 1', 'true + true === 2', '"a" * 1 !== "a" * 1', '1 ** NaN !== 1 ** NaN', 'Infinity % 2 !== Infinity % 2', '5 % Infinity === 5',
	'1 / (0 * -1) === -Infinity', '(-2) ** 2 === 4', '2 ** 0.5 > 1.41', '10 / 3 === 3.3333333333333335', '0.1 * 3 === 0.30000000000000004', '9007199254740992 + 1 === 9007199254740992',
	// bits
	'(5 & 3) === 1', '(5 | 3) === 7', '(5 ^ 3) === 6', '~5 === -6', '~~3.7 === 3', '(1 << 31) === -2147483648', '(1 << 32) === 1', '(-1 >>> 0) === 4294967295',
	'(-1 >> 1) === -1', '(2 ** 32 + 5 | 0) === 5', '(2 ** 31 | 0) === -2147483648', '(-(2 ** 31) - 1 | 0) === 2147483647', '(1e21 | 0) === -559939584', '(NaN | 0) === 0',
	'(Infinity | 0) === 0', '("12" | 0) === 12', '(1.9 | 0) === 1', '(-1.9 | 0) === -1', '(5 >>> 33) === 2', '(5 << -1) === -2147483648', '(-5 >>> 28) === 15',
	'(2 ** 53 | 0) === 0', '(-(2 ** 32) - 7 | 0) === -7', '(4294967295.9 | 0) === -1', '~NaN === -1', '(null | undefined) === 0', '(true << true) === 2',
	// BigInt
	'1n + 2n === 3n', '5n / 2n === 2n', '-5n / 2n === -2n', '-5n % 2n === -1n', '2n ** 64n === 18446744073709551616n', '(-2n) ** 3n === -8n', '~5n === -6n',
	'(5n & 3n) === 1n', '(-5n & 3n) === 3n', '(-5n | 3n) === -5n', '(-5n ^ 3n) === -8n', '(1n << 70n) === 1180591620717411303424n', '(-5n >> 1n) === -3n',
	'(5n >> 200n) === 0n', '(-5n >> 200n) === -1n', '(1n << -1n) === 0n', '1n == 1', '2n > 1', '1n < 1.5', '1n < "2"', '"2" > 1n', '1n == "1"', '0n == ""', '0n == " "',
	'1n == true', '2n > true', '9007199254740993n > 9007199254740992', '9007199254740993n != 9007199254740992', '1n < Infinity', '-1n > -Infinity', '0n == -0',
	'0x10n === 16n', '0b101n === 5n', '0o17n === 15n', '1_000n === 1000n', '-(-3n) === 3n', '0n ** 0n === 1n', '1n ** 9999999999n === 1n', '(-1n) ** 9999999999n === -1n',
	'1n == "0x1"', '-1n == "-1"', '10n > "9"', '!0n', '!!1n', '2n * 3n - 7n === -1n', '170141183460469231731687303715884105727n > 0n', '-170141183460469231731687303715884105727n < 0n',
	// comparison
	'"a" < "b"', '"10" < "9"', 'null >= 0', 'undefined == null', '"" == 0', '"0" == false', 'null === null', '"abc" == "abc"', '1 == "1"', 'true == "1"', '"\\ud83d" < "\\ue000"',
	'"\\u{1F600}" < "\\uffff"', '"a" < "ab"', '"" < "a"', '1 < 2 === true', '"b" > "a"', '2 >= 2', '"2" >= 2', 'null <= 0', '0 === -0', '"1" != 2', 'NaN != NaN', '1 !== "1"',
	'null != 0', 'undefined != 0', 'null != false', '"true" != true', '"\\t1\\n" == 1', '/a/ != /a/', '/a/ !== /a/', '/a/ == "/a/"', '/a/ != null', 'undefined === void 0',
	// logical, conditional, sequence, assignment
	'(0 || 5) === 5', '(1 && 0) === 0', '(null ?? 3) === 3', '(0 ?? 3) === 0', '(1, 2) === 2', '(true ? 1 : x) === 1', '(false ? x : 2) === 2', '(x = 5) === 5',
	'(1 || x) === 1', '(0 && x) === 0', '(1 ?? x) === 1', '("" || null || 7) === 7', '(x, y, 3) === 3', '(1 ? 2 ? 3 : 4 : 5) === 3', '(x = y = 4) === 4', '!(x = 0)',
	// members
	'"abc".length === 3', '"abc"[1] === "b"', '"abc"[5] === undefined', '"abc"["length"] === 3', '"\\u{1F600}".length === 2', '`a${1}b`.length === 3', '"abc"?.length === 3',
	'null?.x === undefined', 'undefined?.x.y.z === undefined', '(null)?.[0] === undefined', 'Math.PI > 3', 'Number.MAX_SAFE_INTEGER === 9007199254740991',
	'Number.MIN_VALUE > 0', 'Number.EPSILON < 1', 'Math["E"] > 2', 'Number.NaN !== Number.NaN', '"abc"["1"] === "b"', '"abc"[1.0] === "b"', '"abc"[-0] === "a"',
	'"abc"[`2`] === "c"', 'Math.SQRT2 * Math.SQRT2 > 2', 'Number.MAX_VALUE * 2 === Infinity', 'Number.MIN_SAFE_INTEGER < 0', 'Math.LN2 < Math.LN10', 'Math.LOG2E > Math.LOG10E',
	'Math.SQRT1_2 < 1', 'Number.POSITIVE_INFINITY === Infinity', 'Number.NEGATIVE_INFINITY === -Infinity', 'Math?.PI > 3', '(Math).PI > 3', 'Number["MAX_" + "VALUE"] > 1e308',
	'/a/.source === "a"', '/a/gi.flags === "gi"', '/a/g.global === true', '/a/.global === false', '/a\\/b/.source === "a\\\\/b"', '/a/y.sticky', '/a/.lastIndex === 0',
	// calls, arrays, objects, new
	'Number("5") === 5', 'String(5) === "5"', 'Boolean(0) === false', 'parseInt("7") === 7', 'Math.abs(-1) === 1', '"a".concat("b") === "ab"', '[1, 2].length === 2',
	'"abc".toUpperCase() === "ABC"', 'String.raw`a\\n` === "a\\\\n"', 'Math.max(1, 2) === 2', 'Number.isNaN(NaN)', 'isNaN("x")', 'new Number(1) + 1 === 2', 'Number() === 0',
	'String() === ""', 'Boolean() === false', 'Number(1n) === 1', 'String(null) === "null"', 'Number("0x10") === 16', 'String.raw`${1}\\u` === "1\\\\u"', '[] + "" === ""',
	'[1, 2] + "" === "1,2"', '({}) + "" === "[object Object]"', '!![]', '!!{}', '({ a: 1 }).a === 1', '[1, 2][1] === 2', 'typeof [] === "object"', 'typeof Math === "object"',
	'typeof String === "function"', '"abc".slice(1) === "bc"', '"abc".charAt(0) === "a"', 'Number.parseFloat("1.5") === 1.5', 'parseFloat("1.5x") === 1.5', 'BigInt(5) === 5n',
	'Math.floor(1.5) === 1', 'Math.round(-0.5) === 0', 'Math.sign(-3) === -1', 'Math.trunc(-1.5) === -1', 'Math.min() === Infinity', '(0, Number)("3") === 3',
	// more than the range of a BigInt of 128 bits
	'2n ** 130n > 0n', '(1n << 200n) > 1n', '340282366920938463463374607431768211456n > 0n', '-(2n ** 127n) < 0n', '0xffffffffffffffffffffffffffffffffffn > 0n',
];
const F = [ // expressions that are false: a value that is wrong the other way shows too
	'1n === 1', '"10" < 9', '1 ** Infinity === 1', 'NaN == NaN', 'null == 0', 'undefined == 0', 'null == false', '"true" == true', '"a" < "B"', 'undefined >= 0',
	'1n == "1.0"', '1n < "x"', '1n > "x"', '1n == "x"', '+"0x1g" === 1', '9007199254740993n == 9007199254740992', '"\\u{1F600}" > "\\uffff"', '/a/ == /a/', '/a/ === /a/',
	'typeof null === "null"', '`${-0}` === "-0"', '0.1 + 0.2 === 0.3', '(1 << 32) === 0', '-5n / 2n === -3n', '(-5n >> 1n) === -2n', '"abc"[5] === null', '"abc".length === 2',
	'1 / +"-0" === Infinity', '(-1 >>> 0) === -1', '5 % -3 === -1', '2n > 2', '"2" > "12" === false', 'null > -1 === false', '+" " !== 0', '!1n', '(0 ?? 3) === 3',
];
const wrap = e => `for (var i = 0; i < 10; i -= (${e}));`;
const shadowed = [
	'var Infinity = -1; for (var i = 0; i < 10; i -= Infinity);', 'function f(NaN) {} for (var i = 0; i < 10; i -= (NaN !== NaN));', 'let undefined; for (var i = 0; i < 10; i -= (undefined === void 0));',
	'var Math; for (var i = 0; i < 10; i -= Math.PI);', 'function f(Number) { for (var i = 0; i < 10; i -= Number.MAX_VALUE); }', 'const n = 1; for (var i = 0; i < 10; i -= n);',
	'let n = 1; for (var i = 0; i < 10; i -= n);', 'var n = 1; n = 2; for (var i = 0; i < 10; i -= n);', 'for (var i = 0; i < 10; i -= Infinity);', 'for (var i = 0; i < 10; i += -Infinity);',
	'for (var i = 0; i < 10; i += NaN);', 'for (var i = 0; i < 10; i -= undefined);', 'for (var i = 0; i < 10; i -= (undefined ?? 1));', 'for (var i = 0; i < 10; i -= (NaN || 1));',
];
process.stdout.write(JSON.stringify([...T.map(wrap), ...F.map(wrap), ...shadowed], null, 1) + "\n");
