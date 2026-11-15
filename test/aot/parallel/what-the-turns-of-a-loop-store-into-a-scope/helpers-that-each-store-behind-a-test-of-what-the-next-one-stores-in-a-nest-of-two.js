function run(turns) {
  let v0 = 0;
  let v1 = 0;
  let v2 = 0;
  let v3 = 0;
  let v4 = 0;
  let v5 = 0;
  let v6 = 0;
  let v7 = 0;
  const h0 = () => { v0 = v0 + 1; };
  const h1 = () => { v1 = v1 + 1; };
  const h2 = () => { v2 = v2 + 1; };
  const h3 = () => { v3 = v3 + 1; };
  const h4 = () => { v4 = v4 + 1; };
  const h5 = () => { v5 = v5 + 1; };
  const h6 = () => { v6 = v6 + 1; };
  const h7 = () => { v7 = v7 + 1; };
  let n = 0;
  while (n !== turns) {
    let m = 0;
    while (m !== 2) {
      if (v6 !== 0) h7();
      if (v5 !== 0) h6();
      if (v4 !== 0) h5();
      if (v3 !== 0) h4();
      if (v2 !== 0) h3();
      if (v1 !== 0) h2();
      if (v0 !== 0) h1();
      h0();
      m = m + 1;
    }
    n = n + 1;
  }
  return [v0, v1, v2, v3, v4, v5, v6, v7].join();
}
console.log(run(0), run(1), run(3), run(10));
