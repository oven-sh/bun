for (const name of ["String", "Number", "BigInt", "parseInt", "parseFloat", "isNaN", "isFinite", "Number.isNaN", "Number.isFinite", "Number.isInteger", "Number.isSafeInteger", "String.fromCodePoint", "Math.sign"])
  check(`a => ${name}(a)`, singles);
for (const name of ["parseInt", "Math.atan2", "Math.hypot", "BigInt.asIntN"]) check(`(a, b) => ${name}(a, b)`, pairs);
for (const name of ["toString", "toFixed", "toPrecision", "valueOf"])
  check(`(a, b) => a.${name}(b)`, across(() => [255, -0, 0.5, 2 ** 40, NaN, 7n], () => [16, 10, 2, 36, 37, 1, 0, 2.5, undefined, "8"]));
check((a, b) => [parseInt(a / b), parseInt(a / b, 10), parseInt(a / b, 7)], () => [[7, 2], [-7, 2], [-1, 2], [1, 2], [0, -1], [1, 1e7], [2 ** 32, 2], [-(2 ** 32), 2], [0, 0]]);
for (const name of ["isNaN", "isFinite", "isInteger", "isSafeInteger"])
  checkInTurn(`a => Number.${name}(a)`, oneOf(() => [1, 0.5, NaN, [Infinity].reduce((a, b) => a - b, Infinity), -Infinity, 2 ** 53, 2 ** 53 - 1, -0, "1", null, undefined, true, {}]), 40);
check(a => [parseInt("12"), "abc".slice(1), Number("0x10"), (255).toString(16), Math.hypot(3, 4), String(-0), parseFloat("-0"), a], () => [[1]]);
