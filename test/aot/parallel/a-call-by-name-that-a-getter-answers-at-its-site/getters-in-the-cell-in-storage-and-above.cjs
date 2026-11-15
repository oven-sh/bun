"use strict";
// COUNT: operation:operationAOTFillSiteAnswers <= 80
const names = JSON.parse('["a","b","c","d","e","f","g","h","i","j","k","l","m","n"]');
const lay = (target, count) => { for (let at = 0; at < count; at++) { const by = at + 1; Object.defineProperty(target, names[at], { get: () => x => (x * by + count) | 0, configurable: true, enumerable: true }); } return target; };
const few = lay(JSON.parse("{}"), 3), many = lay(JSON.parse("{}"), 14);
const bare = lay(Object.create(null), 2), bareMany = lay(Object.create(null), 14);
const seeded = target => { target.seed = 2; return target; };
const written = lay(seeded({}), 3), writtenMany = lay(seeded({}), 14);
const belowFew = Object.create(lay(JSON.parse("{}"), 3)), belowMany = Object.create(lay(JSON.parse("{}"), 14)), belowWritten = Object.create(lay(seeded({}), 14));
function drive(turns) {
  let s = 0;
  for (let i = 0; i < turns; i++) {
    s = (s + few.a(i) + few.c(i) + many.a(i) + many.h(i) + many.n(i)) | 0;
    s = (s + bare.b(i) + bareMany.g(i) + bareMany.n(i)) | 0;
    s = (s + written.a(i) + written.c(i) + writtenMany.b(i) + writtenMany.m(i)) | 0;
    s = (s + belowFew.b(i) + belowMany.c(i) + belowMany.l(i) + belowWritten.a(i) + belowWritten.n(i)) | 0;
  }
  return s;
}
console.log(drive(+(process.argv[2] ?? 3000)));
