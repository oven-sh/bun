// The result of an await is read right behind it and again behind the next suspension; awaits stand in one arm alone.
// Under: --aot-check=Validate: behind each suspension the body names anew what it reads out of its frame in the heap; a compiler that checks itself looks at every such name
const out = [];
async function* chosen(a, b, c, tail) { const first = a || b || (await c); const next = await tail; yield [first, next, String(a)].join(); const more = await first; yield more + next; }
async function* inOneArm(flag, x, y) { let got = 0; if (flag) got = await x; else got = y.length; yield got + y.length; const again = await got; yield again + got; }
async function* looped(list) { let last = "", seen = 0; for (const item of list) { const value = await item; seen++; if (value === last) continue; yield last + value; last = value; } yield seen; }
for (const it of [chosen(0, "", Promise.resolve("c"), "t"), chosen("a", "", "c", Promise.resolve("t")), inOneArm(true, Promise.resolve(4), "yy"), inOneArm(false, 4, "yyy"), looped(["p", Promise.resolve("p"), "q", Promise.resolve("r")])]) for await (const x of it) out.push(x);
console.log(out.join("|"));
