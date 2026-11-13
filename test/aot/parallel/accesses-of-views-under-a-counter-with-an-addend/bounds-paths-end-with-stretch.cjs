// Accesses to a captured view lie in the arm of a guess about their position. What follows that arm runs behind both of its arms, once.
(function () {
  const view = new Uint8Array(256),
    words = new Float64Array(64),
    held = { count: 0, last: "" };
  let count = 0,
    seen = [];
  for (let k = 0; k < 256; k++) view[k] = k * 7;
  function tell(q) {
    count += q.length;
  }
  function calls(p, n, q) {
    const y = ((view[p + 0] | 0) + (view[p + 2] | 0) + (p >> 3)) | 0;
    view[p + 1] = 5;
    tell(q);
    if (n < 3) return y;
    return -1;
  }
  function stores(p, n, q) {
    const y = ((view[p + 0] | 0) + (view[p + 2] | 0) + (p >> 3)) | 0;
    view[p + 1] = 6;
    held.count++;
    held.last = q;
    if (n < 3) return y;
    return -1;
  }
  function pushes(p, n, q) {
    const y = ((view[p + 0] | 0) + (view[p + 2] | 0) + (p >> 3)) | 0;
    view[p + 1] = 7;
    seen.push(q);
    if (n < 3) return y;
    return -1;
  }
  function counts(p, n, q) {
    const y = ((view[p + 0] | 0) + (view[p + 2] | 0) + (p >> 3)) | 0;
    view[p + 1] = 8;
    count++;
    if (n < 3) return y;
    return -1;
  }
  function rounds(p, n) {
    let y = 0,
      z = 0,
      i = 0;
    do {
      y = (y + (view[p + 0] | 0) + (view[p + 1] | 0)) | 0;
      z += +words[(p >> 3) + 0];
      i = (i + 1) | 0;
    } while ((i | 0) < (n | 0));
    return y + z;
  }
  function storesInRounds(p, n, q) {
    let y = 0,
      i = 0;
    do {
      i = (i + 1) | 0;
      y = (y + (view[p + 0] | 0) + (view[p + 1] | 0)) | 0;
      words[p >> 3] = y;
      held.count += q.length;
    } while (i < n);
    return y;
  }
  [calls, stores, pushes, counts, rounds, storesInRounds].forEach(function (f, k) {
    [[0, 3, "a"], ["8", 2, "b"], [24, 4, "c"], ["1", 5, "d"], [undefined, 7, "e"], [3, 2, "f"], ["7", 2, "g"], [300, 2, "h"], [1.5, 2, "i"], [-1, 2, "j"]].forEach(function (a) {
      console.log(k, String(a), f(a[0], a[1], a[2]), count, held.count, held.last, seen.join(""));
    });
    console.log(view.join().length, words.join().length);
  });
})();
