// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# child.closure.always.alias0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.closure.always.own0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.closure.first.alias0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.closure.first.own0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.closure.last-turn.alias0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.closure.last-turn.own0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.closure.rare.alias0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.closure.rare.own0");
  let later;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.always.alias0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.always.own0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.first.alias0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.first.own0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.last-turn.own0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.field.rare.alias0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.field.rare.own0");
  const box = {};
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.always.alias0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.always.own0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    held = k;
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.first.alias0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.first.own0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.last-turn.alias0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.held.last-turn.own0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.rare.alias0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.held.rare.own0");
  let held;
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.json.always.own0");
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, Object.keys(k).length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.json.first.own0");
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, Object.keys(k).length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.json.last-turn.own0");
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.x = 9;
    return [first, Object.keys(k).length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.json.rare.own0");
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, Object.keys(k).length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    seen.add(k);
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.always.alias0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.always.own0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.first.alias0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.first.own0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.sink.rare.own0");
  const sink = [];
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
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
  console.log("# child.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = parent.x;
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
    return [first, parent.x, other ? parent.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = Object.keys(k).length;
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
    return [first, Object.keys(k).length, other ? Object.keys(other).length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# child.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const parent = { x: n };
    const k = Object.create(parent);
    const first = k.x;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
