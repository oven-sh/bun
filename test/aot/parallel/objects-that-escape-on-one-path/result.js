// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# result.closure.always.alias0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.value = 9;
      }
    }
    const other = later?.();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.always.own0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    later = () => k;
    k.value = 9;
    const other = later?.();
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.first.alias0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.value = 9;
      }
    }
    const other = later?.();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.first.own0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.value = 9;
    const other = later?.();
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target.value = 9;
      }
    }
    const other = later?.();
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.value = 9;
    const other = later?.();
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.rare.alias0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.value = 9;
      }
    }
    const other = later?.();
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.closure.rare.own0");
  let later;
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.value = 9;
    const other = later?.();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.always.alias0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.value = 9;
      }
    }
    const other = box.k;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.always.own0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    box.k = k;
    k.value = 9;
    const other = box.k;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.first.alias0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.value = 9;
      }
    }
    const other = box.k;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.first.own0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.value = 9;
    const other = box.k;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target.value = 9;
      }
    }
    const other = box.k;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.value = 9;
    const other = box.k;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.value = 9;
      }
    }
    const other = box.k;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.field.rare.own0");
  const box = {};
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.value = 9;
    const other = box.k;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.always.alias0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.always.own0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    held = k;
    k.value = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.first.alias0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.first.own0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.value = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.last-turn.own0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.value = 9;
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.rare.alias0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.held.rare.own0");
  let held;
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.value = 9;
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.json.always.own0");
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    text = JSON.stringify(k);
    k.value = 9;
    return [first, k.done, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.json.first.own0");
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.value = 9;
    return [first, k.done, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.json.last-turn.own0");
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.value = 9;
    return [first, k.done, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.json.rare.own0");
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.value = 9;
    return [first, k.done, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    keep(k);
    k.value = 9;
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.value = 9;
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.value = 9;
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.value = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.value = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    seen.add(k);
    k.value = 9;
    const other = [...seen].pop();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.value = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.value = 9;
    const other = [...seen].pop();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.value = 9;
      }
    }
    const other = [...seen].pop();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.value = 9;
    const other = [...seen].pop();
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.value = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.value = 9;
    const other = [...seen].pop();
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.value = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    sink.push(k);
    k.value = 9;
    const other = sink[sink.length - 1];
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.value = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.value = 9;
    const other = sink[sink.length - 1];
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.value = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.value = 9;
    const other = sink[sink.length - 1];
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.value = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.value = 9;
    const other = sink[sink.length - 1];
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    keepThis.call(k);
    k.value = 9;
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.value = 9;
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.value;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.value, other ? other.value : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.value = 9;
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = k.done;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.value = 9;
      }
    }
    const other = held;
    return [first, k.done, other ? other.done : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# result.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = [n, 2].values().next();
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.value = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
