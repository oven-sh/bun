// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# split.closure.always.alias0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target[2] = 9;
      }
    }
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.always.own0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    later = () => k;
    k[2] = 9;
    const other = later?.();
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.first.alias0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[2] = 9;
      }
    }
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.first.own0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k[2] = 9;
    const other = later?.();
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target[2] = 9;
      }
    }
    const other = later?.();
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k[2] = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.rare.alias0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[2] = 9;
      }
    }
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.closure.rare.own0");
  let later;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k[2] = 9;
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.always.alias0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target[2] = 9;
      }
    }
    const other = box.k;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.always.own0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    box.k = k;
    k[2] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.first.alias0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[2] = 9;
      }
    }
    const other = box.k;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.first.own0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k[2] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
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
        target[2] = 9;
      }
    }
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k[2] = 9;
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[2] = 9;
      }
    }
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.field.rare.own0");
  const box = {};
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k[2] = 9;
    const other = box.k;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.always.alias0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.always.own0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    held = k;
    k[2] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.first.alias0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.first.own0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n === 0) {
      held = k;
    }
    k[2] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.last-turn.own0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k[2] = 9;
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.rare.alias0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.held.rare.own0");
  let held;
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k[2] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.json.always.own0");
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    text = JSON.stringify(k);
    k[2] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.json.first.own0");
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k[2] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.json.last-turn.own0");
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k[2] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.json.rare.own0");
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k[2] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    keep(k);
    k[2] = 9;
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k[2] = 9;
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k[2] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k[2] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target[2] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    seen.add(k);
    k[2] = 9;
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[2] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k[2] = 9;
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[2] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k[2] = 9;
    const other = [...seen].pop();
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[2] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k[2] = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[2] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    sink.push(k);
    k[2] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[2] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k[2] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
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
        target[2] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k[2] = 9;
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[2] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k[2] = 9;
    const other = sink[sink.length - 1];
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    keepThis.call(k);
    k[2] = 9;
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k[2] = 9;
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k[2];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k[2], other ? other[2] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k[2] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.length;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[2] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# split.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = ("a,b," + n).split(",");
    const first = k.join();
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k[2] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
