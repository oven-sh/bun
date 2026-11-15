const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
for (let turn = 0; turn < 300; turn++) { said.length = 0;
  for (let round = 0; round < 2; round++) {
    const grows = [1, 2, 3]; const seen: number[] = []; grows.forEach(x => { seen.push(x); if (grows.length < 6) grows.push(x * 10); }); said.push(seen, grows);
    const shrinks = [1, 2, 3, 4]; said.push(shrinks.map(x => { shrinks.pop(); return x; }), shrinks);
    const cut = [1, 2, 3, 4]; said.push(cut.filter((x, i) => { if (i === 1) cut.length = 2; return true; }));
    const kinds: unknown[] = [1, 2, 3, 4]; said.push(kinds.map((x, i) => { if (i === 0) kinds[2] = "text"; if (i === 1) kinds[3] = 0.5; return x; }));
    const deleted = [1, 2, 3]; said.push(deleted.reduce((a, x, i) => { if (i === 0) delete deleted[1]; return a + x; }, 0), deleted.some((x, i) => { deleted[i + 1] = 9; return i > 4; }));
    const far: number[] = [1, 2]; said.push(far.every((x, i) => { if (i === 0) far[1000] = 7; return x < 5; }), far.length);
  }
}
console.log(said.map(show).join(" "));
