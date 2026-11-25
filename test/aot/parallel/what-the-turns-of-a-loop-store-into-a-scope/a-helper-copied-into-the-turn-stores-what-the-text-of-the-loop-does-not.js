function run(n, rare) {
  let a = 0,
    b = 0,
    c = 7,
    d = "kept";
  const bump = () => {
    b = b + 2;
  };
  const swap = () => {
    const held = c;
    c = a;
    a = held;
  };
  try {
    for (let i = 0; i < n; i++) {
      a = a + i;
      bump();
      if (i & 1) swap();
    }
    if (rare) throw new Error("rare");
    while (b > 100) bump(), (b = b - 50);
  } catch (e) {
    d = e.message + a + b + c;
  }
  return [a, b, c, d].join();
}
console.log(run(0, false), run(1, false), run(5, true), run(9, false), run(70, true));
