// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# set.closure.always.alias0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.add(9);
      }
    }
    const other = later?.();
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.always.own0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    later = () => k;
    k.add(9);
    const other = later?.();
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.first.alias0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.add(9);
      }
    }
    const other = later?.();
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.first.own0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.add(9);
    const other = later?.();
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target.add(9);
      }
    }
    const other = later?.();
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.add(9);
    const other = later?.();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.rare.alias0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.add(9);
      }
    }
    const other = later?.();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.closure.rare.own0");
  let later;
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.add(9);
    const other = later?.();
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.always.alias0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.add(9);
      }
    }
    const other = box.k;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.always.own0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    box.k = k;
    k.add(9);
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.first.alias0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.add(9);
      }
    }
    const other = box.k;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.first.own0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.add(9);
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
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
        target.add(9);
      }
    }
    const other = box.k;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.add(9);
    const other = box.k;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.add(9);
      }
    }
    const other = box.k;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.field.rare.own0");
  const box = {};
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.add(9);
    const other = box.k;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.freeze.always.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    Object.freeze(k);
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.freeze.first.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      Object.freeze(k);
    }
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.freeze.last-turn.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        Object.freeze(k);
      }
    }
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.freeze.rare.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      Object.freeze(k);
    }
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.always.alias0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.always.own0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    held = k;
    k.add(9);
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.first.alias0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.first.own0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.add(9);
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.last-turn.own0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.add(9);
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.rare.alias0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.held.rare.own0");
  let held;
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.add(9);
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.json.always.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    text = JSON.stringify(k);
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.json.first.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.json.last-turn.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.json.rare.own0");
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.add(9);
    return [first, k.size, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    keep(k);
    k.add(9);
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.add(9);
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.add(9);
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.add(9);
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.add(9);
      }
    }
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    seen.add(k);
    k.add(9);
    const other = [...seen].pop();
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.add(9);
      }
    }
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.add(9);
    const other = [...seen].pop();
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.add(9);
      }
    }
    const other = [...seen].pop();
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.add(9);
    const other = [...seen].pop();
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.add(9);
      }
    }
    const other = [...seen].pop();
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.add(9);
    const other = [...seen].pop();
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.add(9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    sink.push(k);
    k.add(9);
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.add(9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.add(9);
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
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
        target.add(9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.add(9);
    const other = sink[sink.length - 1];
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.add(9);
      }
    }
    const other = sink[sink.length - 1];
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.add(9);
    const other = sink[sink.length - 1];
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    keepThis.call(k);
    k.add(9);
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.add(9);
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.has(n);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.has(n), other ? other.has(n) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.add(9);
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = k.size;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.add(9);
      }
    }
    const other = held;
    return [first, k.size, other ? other.size : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# set.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Set([n]);
    const first = [...k].join();
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.add(9);
    const other = held;
    return [first, [...k].join(), other ? [...other].join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
