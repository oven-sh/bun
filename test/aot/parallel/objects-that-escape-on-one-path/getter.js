// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# getter.closure.always.alias0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    later = () => k;
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
  console.log("# getter.closure.always.own0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.closure.first.alias0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.closure.first.own0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.closure.last-turn.alias0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.closure.last-turn.own0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.closure.rare.alias0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.closure.rare.own0");
  let later;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.always.alias0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    box.k = k;
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
  console.log("# getter.field.always.own0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.first.alias0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.first.own0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.last-turn.alias0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.last-turn.own0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.rare.alias0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.field.rare.own0");
  const box = {};
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.freeze.always.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    Object.freeze(k);
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.freeze.first.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      Object.freeze(k);
    }
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.freeze.last-turn.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        Object.freeze(k);
      }
    }
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.freeze.rare.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      Object.freeze(k);
    }
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.always.alias0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    held = k;
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
  console.log("# getter.held.always.own0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    held = k;
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.first.alias0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.first.own0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.last-turn.alias0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.last-turn.own0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.rare.alias0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.held.rare.own0");
  let held;
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.json.always.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.json.first.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.json.last-turn.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.json.rare.own0");
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x + k.y, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.always.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    keep(k);
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
  console.log("# getter.keep.always.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.first.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.first.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.last-turn.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.last-turn.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.rare.alias0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.keep.rare.own0");
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.always.alias0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    seen.add(k);
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
  console.log("# getter.seen.always.own0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    seen.add(k);
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.first.alias0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.first.own0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.last-turn.alias0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.last-turn.own0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.rare.alias0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.seen.rare.own0");
  const seen = new Set();
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.always.alias0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    sink.push(k);
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
  console.log("# getter.sink.always.own0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.first.alias0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.first.own0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.last-turn.alias0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.last-turn.own0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.rare.alias0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.sink.rare.own0");
  const sink = [];
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.always.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    keepThis.call(k);
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
  console.log("# getter.this.always.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x;
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.first.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.first.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.last-turn.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.last-turn.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.rare.alias0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
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
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# getter.this.rare.own0");
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    let c = n;
    const k = {
      get x() {
        return c;
      },
      set x(v) {
        c = v + 1;
      },
      y: 2,
    };
    const first = k.x + k.y;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y, other ? other.x + other.y : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
