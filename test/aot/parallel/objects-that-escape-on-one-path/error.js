// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# error.closure.always.alias0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.message = "changed";
      }
    }
    const other = later?.();
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.always.own0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    later = () => k;
    k.message = "changed";
    const other = later?.();
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.first.alias0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.message = "changed";
      }
    }
    const other = later?.();
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.first.own0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.message = "changed";
    const other = later?.();
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.last-turn.alias0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    {
      const target = later?.();
      if (target) {
        target.message = "changed";
      }
    }
    const other = later?.();
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.last-turn.own0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.message = "changed";
    const other = later?.();
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.rare.alias0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    {
      const target = later?.();
      if (target) {
        target.message = "changed";
      }
    }
    const other = later?.();
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.closure.rare.own0");
  let later;
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.message = "changed";
    const other = later?.();
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.always.alias0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.message = "changed";
      }
    }
    const other = box.k;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.always.own0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    box.k = k;
    k.message = "changed";
    const other = box.k;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.first.alias0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.message = "changed";
      }
    }
    const other = box.k;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.first.own0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.message = "changed";
    const other = box.k;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.last-turn.alias0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    {
      const target = box.k;
      if (target) {
        target.message = "changed";
      }
    }
    const other = box.k;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.last-turn.own0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.message = "changed";
    const other = box.k;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.rare.alias0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    {
      const target = box.k;
      if (target) {
        target.message = "changed";
      }
    }
    const other = box.k;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.field.rare.own0");
  const box = {};
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.message = "changed";
    const other = box.k;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.always.alias0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.always.own0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    held = k;
    k.message = "changed";
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.first.alias0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n === 0) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.first.own0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.message = "changed";
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.last-turn.alias0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.last-turn.own0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.message = "changed";
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.rare.alias0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n > 100) {
      held = k;
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.held.rare.own0");
  let held;
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.message = "changed";
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.json.always.own0");
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    text = JSON.stringify(k);
    k.message = "changed";
    return [first, typeof k.stack, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.json.first.own0");
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.message = "changed";
    return [first, typeof k.stack, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.json.last-turn.own0");
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.message = "changed";
    return [first, typeof k.stack, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.json.rare.own0");
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.message = "changed";
    return [first, typeof k.stack, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    keep(k);
    k.message = "changed";
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.message = "changed";
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.message = "changed";
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.message = "changed";
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.message = "changed";
      }
    }
    const other = [...seen].pop();
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.always.own0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    seen.add(k);
    k.message = "changed";
    const other = [...seen].pop();
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.message = "changed";
      }
    }
    const other = [...seen].pop();
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.first.own0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.message = "changed";
    const other = [...seen].pop();
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.message = "changed";
      }
    }
    const other = [...seen].pop();
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.message = "changed";
    const other = [...seen].pop();
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    {
      const target = [...seen].pop();
      if (target) {
        target.message = "changed";
      }
    }
    const other = [...seen].pop();
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.message = "changed";
    const other = [...seen].pop();
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.always.alias0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.message = "changed";
      }
    }
    const other = sink[sink.length - 1];
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.always.own0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    sink.push(k);
    k.message = "changed";
    const other = sink[sink.length - 1];
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.first.alias0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.message = "changed";
      }
    }
    const other = sink[sink.length - 1];
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.first.own0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.message = "changed";
    const other = sink[sink.length - 1];
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.message = "changed";
      }
    }
    const other = sink[sink.length - 1];
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.message = "changed";
    const other = sink[sink.length - 1];
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.rare.alias0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.message = "changed";
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.sink.rare.own0");
  const sink = [];
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.message = "changed";
    const other = sink[sink.length - 1];
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    keepThis.call(k);
    k.message = "changed";
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.message = "changed";
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = String(k);
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, String(k), other ? String(other) : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.message = "changed";
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = typeof k.stack;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    {
      const target = held;
      if (target) {
        target.message = "changed";
      }
    }
    const other = held;
    return [first, typeof k.stack, other ? typeof other.stack : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# error.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Error("m" + n);
    const first = k.message;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.message = "changed";
    const other = held;
    return [first, k.message, other ? other.message : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
