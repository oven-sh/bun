// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# arguments.closure.always.alias0");
  let later;
  function run(n, a, b) {
    const k = arguments;
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
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.always.own0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    later = () => k;
    k[1] = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.first.alias0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.first.own0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k[1] = 9;
    const other = later?.();
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.last-turn.alias0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.last-turn.own0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k[1] = 9;
    const other = later?.();
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.rare.alias0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.closure.rare.own0");
  let later;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k[1] = 9;
    const other = later?.();
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.always.alias0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = k[1];
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target[1] = 9;
      }
    }
    const other = box.k;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.always.own0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    box.k = k;
    k[1] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.first.alias0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.first.own0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k[1] = 9;
    const other = box.k;
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.last-turn.alias0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.last-turn.own0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k[1] = 9;
    const other = box.k;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.rare.alias0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.field.rare.own0");
  const box = {};
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k[1] = 9;
    const other = box.k;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.freeze.always.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    Object.freeze(k);
    k[1] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.freeze.first.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n === 0) {
      Object.freeze(k);
    }
    k[1] = 9;
    return [first, k[1] + a, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.freeze.last-turn.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        Object.freeze(k);
      }
    }
    k[1] = 9;
    return [first, a, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.freeze.rare.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n > 100) {
      Object.freeze(k);
    }
    k[1] = 9;
    return [first, a, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.always.alias0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1];
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target[1] = 9;
      }
    }
    const other = held;
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.always.own0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    held = k;
    k[1] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.first.alias0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.first.own0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k[1] = 9;
    const other = held;
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.last-turn.alias0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.last-turn.own0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k[1] = 9;
    const other = held;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.rare.alias0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.held.rare.own0");
  let held;
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k[1] = 9;
    const other = held;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.json.always.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    text = JSON.stringify(k);
    k[1] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.json.first.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k[1] = 9;
    return [first, k[1] + a, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.json.last-turn.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k[1] = 9;
    return [first, a, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.json.rare.own0");
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k[1] = 9;
    return [first, a, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
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
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    keep(k);
    k[1] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k[1] = 9;
    const other = held;
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k[1] = 9;
    const other = held;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k[1] = 9;
    const other = held;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.always.alias0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = k[1];
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target[1] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.always.own0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    seen.add(k);
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.first.alias0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.first.own0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k[1] = 9;
    const other = [...seen].pop();
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.last-turn.alias0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.last-turn.own0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.rare.alias0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.seen.rare.own0");
  const seen = new Set();
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k[1] = 9;
    const other = [...seen].pop();
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.always.alias0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = k[1];
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[1] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[1], other ? other[1] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.always.own0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    sink.push(k);
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.first.alias0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.first.own0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.last-turn.alias0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.last-turn.own0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.rare.alias0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.sink.rare.own0");
  const sink = [];
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k[1] = 9;
    const other = sink[sink.length - 1];
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
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
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k.length;
    let text = "";
    keepThis.call(k);
    k[1] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
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
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = a;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k[1] = 9;
    const other = held;
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k[1] = 9;
    const other = held;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = a;
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
    return [first, a, other ? a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# arguments.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, a, b) {
    const k = arguments;
    const first = k[1] + a;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k[1] = 9;
    const other = held;
    return [first, k[1] + a, other ? other[1] + a : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
