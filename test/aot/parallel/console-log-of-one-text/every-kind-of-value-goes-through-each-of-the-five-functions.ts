// STATISTIC: NativeFunctionsCalledDirectly >= 5
const held: any[] = JSON.parse(
  '["a line", "", "%s and %d", "caf\\u00e9", "\\u65e5\\u672c\\u8a9e \\ud83d\\ude00", 1, -1.5, true, null, [1, "two"], {"a": 1, "b": {"c": [2]}}]',
);
held.push(
  undefined,
  -0,
  NaN,
  10n,
  Symbol("mark"),
  new String("an object"),
  held[0] + " joined to " + held[3],
  "x".repeat(300),
  () => 1,
  class Named {},
  new Map([[1, 2]]),
  new Set(["s"]),
  new Error("told").message,
  new Date(0),
  /a+/g,
  new Uint8Array([1, 2]),
  Object.create(null),
);
for (const value of held) console.log(value);
for (const value of held) console.info(value);
for (const value of held) console.debug(value);
for (const value of held) console.warn(value);
for (const value of held) console.error(value);
console.log();
console.info();
console.debug();
console.warn();
console.error();
console.group("a group");
console.log();
console.error();
for (const value of held) console.log(value);
console.group();
console.warn(held[0]);
console.error(held[4]);
console.groupEnd();
console.info(held[2]);
console.groupEnd();
console.log(held[0]);
