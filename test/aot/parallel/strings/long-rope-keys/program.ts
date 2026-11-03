const narrow = "x".repeat(5000);
const wide = "\u65e5".repeat(5000);
const join = (head: string, tail: string): string => head + tail;
const table: Record<string, number> = {};
table[join(narrow, "-a")] = 1;
table[join(narrow, "-b")] = 2;
table[join(wide, "-a")] = 3;
table[join(narrow.slice(1), "\u65e5-a")] = 4;
table[join(narrow, "")] = 5;
const keys: [string, string][] = [
  ["equal to the first", join(narrow, "-a")],
  ["equal to the second", join(narrow, "-b")],
  ["differs in the last character", join(narrow, "-c")],
  ["differs in the first character", join("y" + narrow.slice(1), "-a")],
  ["differs in the middle", join(narrow.slice(0, 2500) + "y" + narrow.slice(2501), "-a")],
  ["three pieces", narrow.slice(0, 2000) + join(narrow.slice(2000), "-a")],
  ["many pieces", Array.from({ length: 10 }, () => narrow.slice(0, 500)).reduce(join, "") + "-b"],
  ["one character shorter", join(narrow.slice(1), "-a")],
  ["one character longer", join(narrow, "x-a")],
  ["wide", join(wide, "-a")],
  ["wide, differs", join(wide, "-b")],
  ["narrow piece, then wide piece", join(narrow.slice(1), "\u65e5-a")],
  ["narrow, as long as the name with a wide character", join(narrow.slice(1), "z-a")],
  ["wide piece, then narrow piece, as long as a narrow name", join("\u65e5", narrow.slice(1) + "-a")],
  ["a piece that is the whole name", join(narrow, "")],
  ["a substring", join(narrow + "-a-and-more", "").slice(0, 5002)],
];
const child = Object.create(table) as Record<string, number>;
for (const [what, key] of keys) console.log(what, key.length, table[key], key in table, Object.prototype.hasOwnProperty.call(table, key), child[key]);
for (const [what, key] of keys) console.log(what, table[key]);
table[join(narrow, "-a")] = 10;
table[join(narrow, "-c")] = 11;
console.log(table[join(narrow, "-a")], table[join(narrow, "-c")], delete table[join(narrow, "-b")], table[join(narrow, "-b")], Object.keys(table).map(key => key.length).join());
