// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# map.closure.always.alias0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = later?.();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.always.own0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    later = () => k;
    k.set("a", 9);
    const other = later?.();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.first.alias0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = later?.();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.first.own0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.set("a", 9);
    const other = later?.();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = later?.();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.set("a", 9);
    const other = later?.();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.rare.alias0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = later?.();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.closure.rare.own0");
  let later;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.set("a", 9);
    const other = later?.();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.always.alias0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = box.k;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.always.own0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    box.k = k;
    k.set("a", 9);
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.first.alias0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.first.own0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.set("a", 9);
    const other = box.k;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.set("a", 9);
    const other = box.k;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.field.rare.own0");
  const box = {};
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.set("a", 9);
    const other = box.k;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.freeze.always.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    Object.freeze(k);
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.freeze.first.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      Object.freeze(k);
    }
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.freeze.last-turn.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        Object.freeze(k);
      }
    }
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.freeze.rare.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      Object.freeze(k);
    }
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.always.alias0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.always.own0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    held = k;
    k.set("a", 9);
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.first.alias0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.first.own0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.last-turn.own0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.rare.alias0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.held.rare.own0");
  let held;
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.json.always.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    text = JSON.stringify(k);
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.json.first.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.json.last-turn.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.json.rare.own0");
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.set("a", 9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    keep(k);
    k.set("a", 9);
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = [...seen].pop();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    seen.add(k);
    k.set("a", 9);
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.set("a", 9);
    const other = [...seen].pop();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.set("a", 9);
    const other = [...seen].pop();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.set("a", 9);
      }
    }
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.set("a", 9);
    const other = [...seen].pop();
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.set("a", 9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    sink.push(k);
    k.set("a", 9);
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.set("a", 9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.set("a", 9);
    const other = sink[sink.length - 1];
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.set("a", 9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.set("a", 9);
    const other = sink[sink.length - 1];
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.set("a", 9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.set("a", 9);
    const other = sink[sink.length - 1];
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    keepThis.call(k);
    k.set("a", 9);
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.set("a", 9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# map.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Map([["a", n]]);
    const first = k.get("a");
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.set("a", 9);
    const other = held;
    return [first, k.get("a"), other ? other.get("a") : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
