const table = {
  first: 0,
  "1.5": "a",
  7: "seven",
  "-1": null,
  x0: 0, x1: 1, x2: 2, x3: 3, x4: 4, x5: 5, x6: 6, x7: 7, x8: 8, x9: 9,
  x10: 10, x11: 11, x12: 12, x13: 13, x14: 14, x15: 15, x16: 16, x17: 17, x18: 18, x19: 19,
  x20: 20, x21: 21, x22: 22, x23: 23, x24: 24, x25: 25, x26: 26, x27: 27, x28: 28, x29: 29,
  x30: 30, x31: 31, x32: 32, x33: 33, x34: 34, x35: 35, x36: 36, x37: 37, x38: 38, x39: 39,
};
function tell(o) {
  const keys = Object.keys(o);
  let sum = 0;
  for (const k of keys) sum = (sum * 31 + (typeof o[k] === "number" ? o[k] : String(o[k]).length)) | 0;
  return keys.length + " " + keys.slice(0, 5).join() + " " + keys.slice(-3).join() + " " + keys.indexOf("x7") + " " + sum + " " + JSON.stringify(o).length;
}
const views = {};
Object.defineProperty(views, "x0", { enumerable: true, get: function () { return table.x0; } });
Object.defineProperty(views, "x1", { enumerable: true, get: function () { return table.x1; } });
Object.defineProperty(views, "x2", { enumerable: true, get: function () { return table.x2; } });
Object.defineProperty(views, "x3", { enumerable: true, get: function () { return table.x3; } });
Object.defineProperty(views, "x4", { enumerable: true, get: function () { return table.x4; } });
Object.defineProperty(views, "x5", { enumerable: true, get: function () { return table.x5; } });
Object.defineProperty(views, "x6", { enumerable: true, get: function () { return table.x6; } });
Object.defineProperty(views, "x7", { enumerable: true, get: function () { return table.x7; } });
Object.defineProperty(views, "x8", { enumerable: true, get: function () { return table.x8; } });
Object.defineProperty(views, "x9", { enumerable: true, get: function () { return table.x9; } });
Object.defineProperty(views, "x10", { enumerable: true, get: function () { return table.x10; } });
Object.defineProperty(views, "x11", { enumerable: true, get: function () { return table.x11; } });
Object.defineProperty(views, "x12", { enumerable: true, get: function () { return table.x12; } });
Object.defineProperty(views, "x13", { enumerable: true, get: function () { return table.x13; } });
Object.defineProperty(views, "x14", { enumerable: true, get: function () { return table.x14; } });
Object.defineProperty(views, "x15", { enumerable: true, get: function () { return table.x15; } });
Object.defineProperty(views, "x16", { enumerable: true, get: function () { return table.x16; } });
Object.defineProperty(views, "x17", { enumerable: true, get: function () { return table.x17; } });
Object.defineProperty(views, "x18", { enumerable: true, get: function () { return table.x18; } });
Object.defineProperty(views, "x19", { enumerable: true, get: function () { return table.x19; } });
Object.defineProperty(views, "x20", { enumerable: true, get: function () { return table.x20; } });
Object.defineProperty(views, "x21", { enumerable: true, get: function () { return table.x21; } });
Object.defineProperty(views, "x22", { enumerable: true, get: function () { return table.x22; } });
Object.defineProperty(views, "x23", { enumerable: true, get: function () { return table.x23; } });
Object.defineProperty(views, "x24", { enumerable: true, get: function () { return table.x24; } });
Object.defineProperty(views, "x25", { enumerable: true, get: function () { return table.x25; } });
Object.defineProperty(views, "x26", { enumerable: true, get: function () { return table.x26; } });
Object.defineProperty(views, "x27", { enumerable: true, get: function () { return table.x27; } });
Object.defineProperty(views, "x28", { enumerable: true, get: function () { return table.x28; } });
Object.defineProperty(views, "x29", { enumerable: true, get: function () { return table.x29; } });
Object.defineProperty(views, "x30", { enumerable: true, get: function () { return table.x30; } });
Object.defineProperty(views, "x31", { enumerable: true, get: function () { return table.x31; } });
Object.defineProperty(views, "x32", { enumerable: true, get: function () { return table.x32; } });
Object.defineProperty(views, "x33", { enumerable: true, get: function () { return table.x33; } });
Object.defineProperty(views, "x34", { enumerable: true, get: function () { return table.x34; } });
Object.defineProperty(views, "x35", { enumerable: true, get: function () { return table.x35; } });
Object.defineProperty(views, "x36", { enumerable: true, get: function () { return table.x36; } });
Object.defineProperty(views, "x37", { enumerable: true, get: function () { return table.x37; } });
Object.defineProperty(views, "x38", { enumerable: true, get: function () { return table.x38; } });
Object.defineProperty(views, "x39", { enumerable: true, get: function () { return table.x39; } });
console.log(tell(views));
console.log(tell(table), table["1.5"], table[7], table["-1"], table.first, table.x3, table.x998, table.x999, table.x1000, table.x39);
table.x3 = "other";
table.x999 = "late";
table.added = 1;
delete table.x2;
delete table.x1000;
console.log(tell(table), views.x0, table.x3, table.x999, table.x1000, table.added);
for (const k in table) if (k === "x1" || k === "first" || k === "added") console.log(k);
console.log(Object.getOwnPropertyNames(table).length, Object.entries(table).length, JSON.stringify(Object.getOwnPropertyDescriptor(table, "x1")), Object.isExtensible(table));
