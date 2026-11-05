// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# bound.closure.always.alias0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.always.own0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.first.alias0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.first.own0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.closure.rare.own0");
  function add(p, q) {
    return p + q;
  }
  let later;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.always.alias0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.always.own0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.first.alias0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.first.own0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.x = 9;
    const other = box.k;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.field.rare.own0");
  function add(p, q) {
    return p + q;
  }
  const box = {};
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.always.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.always.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    held = k;
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.first.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.first.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.held.rare.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.json.always.own0");
  function add(p, q) {
    return p + q;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.json.first.own0");
  function add(p, q) {
    return p + q;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.json.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.x = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.json.rare.own0");
  function add(p, q) {
    return p + q;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k(1), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.always.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.always.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.first.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.first.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.keep.rare.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.always.alias0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.always.own0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    seen.add(k);
    k.x = 9;
    const other = [...seen].pop();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.first.alias0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.first.own0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.seen.rare.own0");
  function add(p, q) {
    return p + q;
  }
  const seen = new Set();
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.always.alias0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.always.own0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.first.alias0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.first.own0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.sink.rare.own0");
  function add(p, q) {
    return p + q;
  }
  const sink = [];
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.always.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.always.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.first.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.first.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.last-turn.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.last-turn.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.rare.alias0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k.x;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# bound.this.rare.own0");
  function add(p, q) {
    return p + q;
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = add.bind(null, n);
    const first = k(1);
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k(1), other ? other(1) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
