// Two variables are compared twice, the second time perhaps the other way round, and an arm between or behind the two tests changes one of them.
{
  console.log("# t1-e-lt-f.t2-a-eq-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (a === f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-and");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e === f && f === e) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-diff");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e - f === 0) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-eq-a");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e === a) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-eq-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e === f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-ge-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e >= f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-le-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e <= f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-leq-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e == f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-lt-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e < f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-e-ne-f");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e !== f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-f-ge-e");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (f >= e) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-f-gt-e");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (f > e) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-f-leq-e");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (f == e) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-f-ne-e");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (f !== e) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-is-swapped");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (Object.is(f, e)) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-is");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (Object.is(e, f)) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-not-eq");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (!(e === f)) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-not-lt");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (!(e < f)) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-or");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (e === f || e < f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
{
  console.log("# t1-e-lt-f.t2-typeof");
  const box = {};
  function k(x, y) {
    let a = x,
      e = -2147483648,
      f = (a + 3) | 0;
    if (e < f) {
      a ^= 1;
    }
    if (typeof e === typeof f) {
      a = 0;
    } else {
      f++;
    }
    return [a, e, f].map(String).join();
  }
  try {
    for (const [x, y] of [
      [0, 1],
      [100, 3],
      [8, 8],
      [5, -2147483648],
      [-2147483651, 0],
      [2147483644, 2147483647],
    ])
      console.log(k(x, y));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
