"use strict";
const key = JSON.parse('"next"');
class Made { constructor(x) { this.x = x; } }
const kept = { seen: 0 };
const ways = [x => x + 1, function (x) { return x + (this === table ? 10 : 1000); }, Math.abs, (x => x * 2).bind(null), function (x) { return arguments.length + x; }, Made, undefined, 7, "text", null, { call() {} }];
const table = Object.defineProperty(JSON.parse("{}"), key, { get() { return ways[kept.seen++ % ways.length]; }, configurable: true });
function drive(turns) {
  let s = 0; const log = [];
  for (let i = 0; i < turns; i++) {
    try { s = (s + table.next(-i)) | 0; } catch (error) { if (log.length < 6) log.push(error.constructor.name + ": " + error.message); }
  }
  return s + "\n" + log.join("\n") + "\n" + kept.seen;
}
console.log(drive(+(process.argv[2] ?? 330)));
