const unseen = (x) => [x][JSON.parse("0")];
const a = unseen(0), o = unseen({ p: {} }), k = unseen("p"), f = unseen(() => 0);
let y;
const say = (g) => {
  try {
    g();
    console.log("no throw");
  } catch (e) {
    console.log(e.name, JSON.stringify(e.message));
  }
};
say(() => o.nope({ 10000: a }));
say(() => o.nope({ 100000: a, 1000000000: a, 10000000000: a, 1000: a }));
say(() => o.nope({ 1e4: a, 0.5: a, 1e21: a, 0x10: a, 1_000: a, 20000: a }));
say(() => o.nope({ [10000]: a, [0.5]: a }));
say(() => o.nope({ "a\nb": a }));
say(() => o.nope({ "it's": a, 'say "x"': a, "a`b": a, "a-b": a, "a\n\n'b": a }));
say(() => o.nope({ ["a\nb"]: a }));
say(() => o.nope("a\nb", o["a\nb"]));
say(() => o.nope(({ 10000: x, "a\nb": z }) => x));
say(() => o.nope(({ 10000: x = a, [10000]: z }) => x));
say(() => o.nope({ 10000: a }[10000]));
