// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# rest.closure.always.alias0");
  let later;
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target[0] = 9;
      }
    }
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.always.own0");
  let later;
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    later = () => k;
    k[0] = 9;
    const other = later?.();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.first.alias0");
  let later;
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[0] = 9;
      }
    }
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.first.own0");
  let later;
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k[0] = 9;
    const other = later?.();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.last-turn.alias0");
  let later;
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target[0] = 9;
      }
    }
    const other = later?.();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.last-turn.own0");
  let later;
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k[0] = 9;
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.rare.alias0");
  let later;
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target[0] = 9;
      }
    }
    const other = later?.();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.closure.rare.own0");
  let later;
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k[0] = 9;
    const other = later?.();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.always.alias0");
  const box = {};
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target[0] = 9;
      }
    }
    const other = box.k;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.always.own0");
  const box = {};
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    box.k = k;
    k[0] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.first.alias0");
  const box = {};
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[0] = 9;
      }
    }
    const other = box.k;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.first.own0");
  const box = {};
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k[0] = 9;
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.last-turn.alias0");
  const box = {};
  function run(n, ...k) {
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
        target[0] = 9;
      }
    }
    const other = box.k;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.last-turn.own0");
  const box = {};
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k[0] = 9;
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.rare.alias0");
  const box = {};
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target[0] = 9;
      }
    }
    const other = box.k;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.field.rare.own0");
  const box = {};
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k[0] = 9;
    const other = box.k;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.always.alias0");
  let held;
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.always.own0");
  let held;
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    held = k;
    k[0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.first.alias0");
  let held;
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.first.own0");
  let held;
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n === 0) {
      held = k;
    }
    k[0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.last-turn.alias0");
  let held;
  function run(n, ...k) {
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
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.last-turn.own0");
  let held;
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k[0] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.rare.alias0");
  let held;
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.held.rare.own0");
  let held;
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k[0] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.json.always.own0");
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    text = JSON.stringify(k);
    k[0] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.json.first.own0");
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k[0] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.json.last-turn.own0");
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k[0] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.json.rare.own0");
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k[0] = 9;
    return [first, k.length, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    keep(k);
    k[0] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k[0] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k[0] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k[0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.always.alias0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target[0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.always.own0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    seen.add(k);
    k[0] = 9;
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.first.alias0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.first.own0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k[0] = 9;
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.last-turn.alias0");
  const seen = new Set();
  function run(n, ...k) {
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
        target[0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.last-turn.own0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k[0] = 9;
    const other = [...seen].pop();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.rare.alias0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target[0] = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.seen.rare.own0");
  const seen = new Set();
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k[0] = 9;
    const other = [...seen].pop();
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.always.alias0");
  const sink = [];
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.always.own0");
  const sink = [];
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    sink.push(k);
    k[0] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.first.alias0");
  const sink = [];
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.first.own0");
  const sink = [];
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k[0] = 9;
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.last-turn.alias0");
  const sink = [];
  function run(n, ...k) {
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
        target[0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.last-turn.own0");
  const sink = [];
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k[0] = 9;
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.rare.alias0");
  const sink = [];
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target[0] = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.sink.rare.own0");
  const sink = [];
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k[0] = 9;
    const other = sink[sink.length - 1];
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    keepThis.call(k);
    k[0] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k[0] = 9;
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k[0];
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k[0], other ? other[0] : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k[0] = 9;
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k.length;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target[0] = 9;
      }
    }
    const other = held;
    return [first, k.length, other ? other.length : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
{
  console.log("# rest.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n, ...k) {
    const first = k.join();
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k[0] = 9;
    const other = held;
    return [first, k.join(), other ? other.join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n, 1, 2)));
}
