// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# instance.closure.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    later = () => k;
    {
      const target = later?.();
      if (target) {
        target.x = 9;
      }
    }
    const other = later?.();
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.closure.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let later;
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.field.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
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
  console.log("# instance.field.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
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
  console.log("# instance.field.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.field.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.field.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.field.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.x = 9;
    const other = box.k;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.field.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.field.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const box = {};
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    held = k;
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.held.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.json.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, Object.keys(k).join(), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.json.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, Object.keys(k).join(), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.json.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.x = 9;
    return [first, k.sum(), text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.json.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    keep(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.keep.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    seen.add(k);
    k.x = 9;
    const other = [...seen].pop();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.seen.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.sink.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
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
  console.log("# instance.sink.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
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
  console.log("# instance.sink.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.sink.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.sink.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.sink.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.sink.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.sink.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.always.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    keepThis.call(k);
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.always.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.first.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
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
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.first.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.sum();
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.sum(), other ? other.sum() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.last-turn.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.last-turn.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.rare.alias0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
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
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# instance.this.rare.own0");
  class Vec {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    sum() {
      return this.x + this.y;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Vec(n, 2);
    const first = Object.keys(k).join();
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, Object.keys(k).join(), other ? Object.keys(other).join() : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
