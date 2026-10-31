// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# pair.closure.always.alias0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target[1] = 9;
      }
    }
    const other = later?.();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.always.own0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    later = () => k;
    k[1] = 9;
    const other = later?.();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.first.alias0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[1] = 9;
      }
    }
    const other = later?.();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.first.own0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k[1] = 9;
    const other = later?.();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target[1] = 9;
      }
    }
    const other = later?.();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k[1] = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.rare.alias0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[1] = 9;
      }
    }
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.closure.rare.own0");
  let later;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k[1] = 9;
    const other = later?.();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.always.alias0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target[1] = 9;
      }
    }
    const other = box.k;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.always.own0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    box.k = k;
    k[1] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.first.alias0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[1] = 9;
      }
    }
    const other = box.k;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.first.own0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k[1] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target[1] = 9;
      }
    }
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k[1] = 9;
    const other = box.k;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[1] = 9;
      }
    }
    const other = box.k;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.field.rare.own0");
  const box = {};
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k[1] = 9;
    const other = box.k;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.always.alias0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.always.own0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    held = k;
    k[1] = 9;
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.first.alias0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.first.own0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n === 0) {
      held = k;
    }
    k[1] = 9;
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.last-turn.own0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k[1] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.rare.alias0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.held.rare.own0");
  let held;
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k[1] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.json.always.own0");
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    text = JSON.stringify(k);
    k[1] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.json.first.own0");
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k[1] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.json.last-turn.own0");
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k[1] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.json.rare.own0");
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k[1] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    keep(k);
    k[1] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k[1] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k[1] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k[1] = 9;
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target[1] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    seen.add(k);
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[1] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[1] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[1] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[1] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    sink.push(k);
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[1] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[1] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[1] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    keepThis.call(k);
    k[1] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k[1] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k[1] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k.length;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# pair.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = Object.entries({ p: n })[0];
    const first = k[1];
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k[1] = 9;
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
