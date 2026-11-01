// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# nested.closure.always.alias0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = later?.();
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.always.own0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    later = () => k;
    k.inner.x = 9;
    const other = later?.();
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.first.alias0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = later?.();
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.first.own0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.inner.x = 9;
    const other = later?.();
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = later?.();
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.inner.x = 9;
    const other = later?.();
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.rare.alias0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = later?.();
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.closure.rare.own0");
  let later;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.inner.x = 9;
    const other = later?.();
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.always.alias0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = box.k;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.always.own0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    box.k = k;
    k.inner.x = 9;
    const other = box.k;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.first.alias0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = box.k;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.first.own0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.inner.x = 9;
    const other = box.k;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = box.k;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.inner.x = 9;
    const other = box.k;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = box.k;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.field.rare.own0");
  const box = {};
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.inner.x = 9;
    const other = box.k;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.freeze.always.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    Object.freeze(k);
    k.inner.x = 9;
    return [first, JSON.stringify(k), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.freeze.first.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      Object.freeze(k);
    }
    k.inner.x = 9;
    return [first, JSON.stringify(k), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.freeze.last-turn.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        Object.freeze(k);
      }
    }
    k.inner.x = 9;
    return [first, k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.freeze.rare.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      Object.freeze(k);
    }
    k.inner.x = 9;
    return [first, k.inner.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.always.alias0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.always.own0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    held = k;
    k.inner.x = 9;
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.first.alias0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.first.own0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.inner.x = 9;
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.last-turn.own0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.inner.x = 9;
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.rare.alias0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.held.rare.own0");
  let held;
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.inner.x = 9;
    const other = held;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.json.always.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    text = JSON.stringify(k);
    k.inner.x = 9;
    return [first, k.inner.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.json.first.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.inner.x = 9;
    return [first, k.inner.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.json.last-turn.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.inner.x = 9;
    return [first, JSON.stringify(k), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.json.rare.own0");
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.inner.x = 9;
    return [first, k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    keep(k);
    k.inner.x = 9;
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.inner.x = 9;
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.inner.x = 9;
    const other = held;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.inner.x = 9;
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    seen.add(k);
    k.inner.x = 9;
    const other = [...seen].pop();
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.inner.x = 9;
    const other = [...seen].pop();
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.inner.x = 9;
    const other = [...seen].pop();
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.inner.x = 9;
    const other = [...seen].pop();
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    sink.push(k);
    k.inner.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.inner.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.inner.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.inner.x = 9;
    const other = sink[sink.length - 1];
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    keepThis.call(k);
    k.inner.x = 9;
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = JSON.stringify(k);
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.inner.x = 9;
    const other = held;
    return [first, JSON.stringify(k), other ? JSON.stringify(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.inner.x = 9;
    const other = held;
    return [first, k.y, other ? other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.inner.x = 9;
      }
    }
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = { inner: { x: n }, y: 2 };
    const first = k.inner.x;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.inner.x = 9;
    const other = held;
    return [first, k.inner.x, other ? other.inner.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
