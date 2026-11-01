// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# made-by-call.closure.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.closure.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.closure.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.closure.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.closure.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.closure.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.closure.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.closure.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let later;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.field.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.field.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.field.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.field.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.field.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.field.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.field.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.field.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const box = {};
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.held.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.held.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    held = k;
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.held.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.held.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.held.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.held.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.held.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.held.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.json.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.json.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.json.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.json.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.keep.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.keep.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.keep.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.keep.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.keep.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.keep.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.keep.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.keep.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.seen.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.seen.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    seen.add(k);
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.seen.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.seen.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.seen.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.seen.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.seen.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.seen.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const seen = new Set();
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.sink.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.sink.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.sink.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.sink.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.sink.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.sink.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.sink.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.sink.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  const sink = [];
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.this.always.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.this.always.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
    const first = k.x + k.y;
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# made-by-call.this.first.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.this.first.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.this.last-turn.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.this.last-turn.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.this.rare.alias0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
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
  console.log("# made-by-call.this.rare.own0");
  function make(x) {
    return { x, y: 2 };
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = make(n);
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
