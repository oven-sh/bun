// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# text-object.closure.always.alias0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.always.own0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.first.alias0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.first.own0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.rare.alias0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.closure.rare.own0");
  let later;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.always.alias0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.always.own0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.first.alias0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.first.own0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.x = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.field.rare.own0");
  const box = {};
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.always.alias0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.always.own0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    held = k;
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.first.alias0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.first.own0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.last-turn.own0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.rare.alias0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.held.rare.own0");
  let held;
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.json.always.own0");
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, k + "", text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.json.first.own0");
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k + "", text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.json.last-turn.own0");
  function run(n) {
    const k = new String("s" + n);
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
  console.log("# text-object.json.rare.own0");
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    seen.add(k);
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k + "";
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
    return [first, k + "", other ? other + "" : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# text-object.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new String("s" + n);
    const first = k.length;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
