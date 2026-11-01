// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# loop-made.closure.always.alias0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.closure.always.own0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.closure.first.alias0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.closure.first.own0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.closure.last-turn.alias0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.closure.last-turn.own0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.closure.rare.alias0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.closure.rare.own0");
  let later;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.field.always.alias0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.field.always.own0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.field.first.alias0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.field.first.own0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.field.last-turn.alias0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.field.last-turn.own0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.field.rare.alias0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.field.rare.own0");
  const box = {};
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.held.always.alias0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.held.always.own0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.held.first.alias0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.held.first.own0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.held.last-turn.alias0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.held.last-turn.own0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.held.rare.alias0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.held.rare.own0");
  let held;
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.json.always.own0");
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.json.first.own0");
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.json.last-turn.own0");
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.json.rare.own0");
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.always.own0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.first.own0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.sink.always.alias0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.sink.always.own0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.sink.first.alias0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.sink.first.own0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.sink.rare.alias0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.sink.rare.own0");
  const sink = [];
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# loop-made.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
  console.log("# loop-made.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let k = { x: 0 };
    for (let i = 0; i < 3; i++) k = { x: k.x + n };
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
