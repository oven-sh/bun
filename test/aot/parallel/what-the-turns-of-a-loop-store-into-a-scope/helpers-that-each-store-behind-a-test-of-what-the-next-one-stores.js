function run(turns) {
  let v0 = 0;
  let v1 = 0;
  let v2 = 0;
  let v3 = 0;
  let v4 = 0;
  let v5 = 0;
  let v6 = 0;
  let v7 = 0;
  let v8 = 0;
  let v9 = 0;
  let v10 = 0;
  let v11 = 0;
  const h0 = () => { v0 = v0 + 1; };
  const h1 = () => { v1 = v1 + 1; };
  const h2 = () => { v2 = v2 + 1; };
  const h3 = () => { v3 = v3 + 1; };
  const h4 = () => { v4 = v4 + 1; };
  const h5 = () => { v5 = v5 + 1; };
  const h6 = () => { v6 = v6 + 1; };
  const h7 = () => { v7 = v7 + 1; };
  const h8 = () => { v8 = v8 + 1; };
  const h9 = () => { v9 = v9 + 1; };
  const h10 = () => { v10 = v10 + 1; };
  const h11 = () => { v11 = v11 + 1; };
  let n = 0;
  while (n !== turns) {
    if (v10 !== 0) h11();
    if (v9 !== 0) h10();
    if (v8 !== 0) h9();
    if (v7 !== 0) h8();
    if (v6 !== 0) h7();
    if (v5 !== 0) h6();
    if (v4 !== 0) h5();
    if (v3 !== 0) h4();
    if (v2 !== 0) h3();
    if (v1 !== 0) h2();
    if (v0 !== 0) h1();
    h0();
    n = n + 1;
  }
  return [v0, v2, v4, v6, v8, v10].join();
}
console.log(run(0), run(1), run(3), run(14));
