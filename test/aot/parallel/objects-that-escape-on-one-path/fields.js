// An object that need not be made is used whole on some path only, is changed under its own name or under the name it escaped to, and is read under both.
{
  console.log("# fields.closure.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
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
  console.log("# fields.closure.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    later = () => k;
    k.x = 9;
    const other = later?.();
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.closure.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.closure.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    if (n === 0) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.closure.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.closure.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        later = () => k;
      }
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.closure.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.closure.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let later;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    if (n > 100) {
      later = () => k;
    }
    k.x = 9;
    const other = later?.();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    box.k = k;
    {
      const target = box.k;
      if (target) {
        target.x = 9;
      }
    }
    const other = box.k;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    box.k = k;
    k.x = 9;
    const other = box.k;
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    if (n === 0) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        box.k = k;
      }
    }
    k.x = 9;
    const other = box.k;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.field.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const box = {};
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    if (n > 100) {
      box.k = k;
    }
    k.x = 9;
    const other = box.k;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    held = k;
    {
      const target = held;
      if (target) {
        target.x = 9;
      }
    }
    const other = held;
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
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
  console.log("# fields.held.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    if (n === 0) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        held = k;
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.held.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    if (n > 100) {
      held = k;
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.json.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    text = JSON.stringify(k);
    k.x = 9;
    return [first, k.x + k.y + k.z, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.json.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    if (n === 0) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x + k.y + k.z, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.json.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        text = JSON.stringify(k);
      }
    }
    k.x = 9;
    return [first, k.x + k.y + k.z, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.json.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    if (n > 100) {
      text = JSON.stringify(k);
    }
    k.x = 9;
    return [first, k.x + k.y + k.z, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
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
  console.log("# fields.keep.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    keep(k);
    k.x = 9;
    const other = held;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    if (n === 0) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keep(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.keep.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keep(v) {
    held = v;
    return typeof v;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    if (n > 100) {
      keep(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    seen.add(k);
    {
      const target = [...seen].pop();
      if (target) {
        target.x = 9;
      }
    }
    const other = [...seen].pop();
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
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
  console.log("# fields.seen.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    if (n === 0) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        seen.add(k);
      }
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.seen.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const seen = new Set();
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    if (n > 100) {
      seen.add(k);
    }
    k.x = 9;
    const other = [...seen].pop();
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    sink.push(k);
    {
      const target = sink[sink.length - 1];
      if (target) {
        target.x = 9;
      }
    }
    const other = sink[sink.length - 1];
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    sink.push(k);
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    if (n === 0) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        sink.push(k);
      }
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.sink.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  const sink = [];
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    if (n > 100) {
      sink.push(k);
    }
    k.x = 9;
    const other = sink[sink.length - 1];
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.always.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
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
  console.log("# fields.this.always.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    keepThis.call(k);
    k.x = 9;
    const other = held;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.first.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
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
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.first.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
    let text = "";
    if (n === 0) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.last-turn.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.z;
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
    return [first, k.z, other ? other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.last-turn.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
    let text = "";
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        keepThis.call(k);
      }
    }
    k.x = 9;
    const other = held;
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.rare.alias0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x + k.y + k.z;
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
    return [first, k.x + k.y + k.z, other ? other.x + other.y + other.z : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
{
  console.log("# fields.this.rare.own0");
  class Box {
    x = 1;
    y = 2;
    #z = 3;
    get z() {
      return this.#z;
    }
    set z(v) {
      this.#z = v;
    }
  }
  let held;
  function keepThis() {
    held = this;
  }
  function run(n) {
    const k = new Box();
    k.x = n;
    const first = k.x;
    let text = "";
    if (n > 100) {
      keepThis.call(k);
    }
    k.x = 9;
    const other = held;
    return [first, k.x, other ? other.x : "-", other === k, text].join("|");
  }
  for (const n of [0, 1, 200, 2, 201, 3]) console.log(String(run(n)));
}
