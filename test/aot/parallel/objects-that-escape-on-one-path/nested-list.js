// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# nested-list.closure.always.alias0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = later?.();
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.always.own0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    later = () => k;
    k[0][0] = 9;
    const other = later?.();
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.first.alias0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = later?.();
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.first.own0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k[0][0] = 9;
    const other = later?.();
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k[0][0] = 9;
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.rare.alias0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = later?.();
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.closure.rare.own0");
  let later;
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k[0][0] = 9;
    const other = later?.();
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.always.alias0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.always.own0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    box.k = k;
    k[0][0] = 9;
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.first.alias0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.first.own0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k[0][0] = 9;
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = box.k;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k[0][0] = 9;
    const other = box.k;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = box.k;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.field.rare.own0");
  const box = {};
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k[0][0] = 9;
    const other = box.k;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.freeze.always.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    Object.freeze(k);
    k[0][0] = 9;
    return [first, k[0][0], text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.freeze.first.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      Object.freeze(k);
    }
    k[0][0] = 9;
    return [first, k[0][0], text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.freeze.last-turn.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        Object.freeze(k);
      }
    }
    k[0][0] = 9;
    return [first, k.join(), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.freeze.rare.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      Object.freeze(k);
    }
    k[0][0] = 9;
    return [first, k[1].length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.always.alias0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.always.own0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    held = k;
    k[0][0] = 9;
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.first.alias0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.first.own0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k[0][0] = 9;
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.last-turn.own0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k[0][0] = 9;
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.rare.alias0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.held.rare.own0");
  let held;
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n > 100) {
      held = k;
    }
    k[0][0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.json.always.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    text = JSON.stringify(k);
    k[0][0] = 9;
    return [first, k[1].length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.json.first.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k[0][0] = 9;
    return [first, k[1].length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.json.last-turn.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k[0][0] = 9;
    return [first, k[0][0], text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.json.rare.own0");
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k[0][0] = 9;
    return [first, k.join(), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    keep(k);
    k[0][0] = 9;
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k[0][0] = 9;
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k[0][0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k[0][0] = 9;
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    seen.add(k);
    k[0][0] = 9;
    const other = [...seen].pop();
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k[0][0] = 9;
    const other = [...seen].pop();
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k[0][0] = 9;
    const other = [...seen].pop();
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k[0][0] = 9;
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    sink.push(k);
    k[0][0] = 9;
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k[0][0] = 9;
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k[0][0] = 9;
    const other = sink[sink.length - 1];
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k[0][0] = 9;
    const other = sink[sink.length - 1];
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    keepThis.call(k);
    k[0][0] = 9;
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[0][0];
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k[0][0] = 9;
    const other = held;
    return [first, k[0][0], other ? other[0][0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k[0][0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[0][0] = 9;
      }
    }
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# nested-list.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [[n], [2]];
    const first = k[1].length;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k[0][0] = 9;
    const other = held;
    return [first, k[1].length, other ? other[1].length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
