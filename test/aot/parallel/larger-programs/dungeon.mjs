// A world of rooms that is carved by rules, actors with turns and energy, sight, paths, items with effects, a log, saves and replays
const DIRECTIONS = {
  n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0], nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1,
    1]
};
class Dice {
  constructor(seed) {
    this.state = seed >>> 0 || 1;
    this.rolled = 0;
  }
  next() {
    this.rolled++;
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  roll(text) {
    const m = /^(\d+)d(\d+)(?:([+-])(\d+))?$/.exec(text);
    if (!m) throw new SyntaxError("bad dice " + text);
    let sum = 0;
    for (let i = 0; i < +m[1]; i++) sum += this.int(1, +m[2]);
    return m[3] ? sum + (m[3] === "-" ? -m[4] : +m[4]) : sum;
  }
  pick(list) {
    return list[this.int(0, list.length - 1)];
  }
  chance(p) {
    return this.next() < p;
  }
  weighted(entries) {
    let r = this.next() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of entries) if ((r -= w) < 0) return v;
    return entries.at(-1)[0];
  }
}
class Grid {
  constructor(width, height, fill) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(fill);
  }
  has(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  get(x, y) {
    return this.has(x, y) ? this.cells[y * this.width + x] : undefined;
  }
  set(x, y, v) {
    if (!this.has(x, y)) throw new RangeError(`${x},${y} is outside`);
    this.cells[y * this.width + x] = v;
  }
  *[Symbol.iterator]() {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) yield [x, y,
      this.cells[y * this.width + x]];
  }
  count(f) {
    let n = 0;
    for (const c of this.cells) if (f(c)) n++;
    return n;
  }
}
class Level {
  constructor(width, height, dice, depth = 1) {
    this.tiles = new Grid(width, height, "#");
    this.dice = dice;
    this.depth = depth;
    this.rooms = [];
    this.items = new Map();
    this.seen = new Set();
    for (let i = 0; i < 60 && this.rooms.length < 9; i++) {
      const w = dice.int(3, 8), h = dice.int(3, 5), x = dice.int(1, width - w - 2),
        y = dice.int(1, height - h - 2);
      if (this.rooms.some(r => x <= r.x + r.w && r.x <= x + w && y <= r.y + r.h &&
        r.y <= y + h)) continue;
      const room = {
        x, y, w, h, get center() {
          return [this.x + (this.w >> 1), this.y + (this.h >> 1)];
        }
    };
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.tiles.set(xx,
        yy, ".");
      if (this.rooms.length) this.#tunnel(this.rooms.at(-1).center, room.center);
      this.rooms.push(room);
    }
    for (const r of this.rooms) if (dice.chance(0.5)) this.#doors(r);
    const [sx, sy] = this.rooms.at(-1).center;
    this.tiles.set(sx, sy, ">");
  }
  #tunnel([x, y], [tx, ty]) {
    const across = this.dice.chance(0.5);
    const dig = (a, b) => {
      if (this.tiles.get(a, b) === "#") this.tiles.set(a, b, ".");
  };
    if (across) {
      while (x !== tx) {
        dig(x, y);
        x += Math.sign(tx - x);
    } while (y !== ty) {
        dig(x, y);
        y += Math.sign(ty - y);
      }
  } else {
      while (y !== ty) {
        dig(x, y);
        y += Math.sign(ty - y);
    } while (x !== tx) {
        dig(x, y);
        x += Math.sign(tx - x);
      }
    }
    dig(x, y);
  }
  #doors({ x, y, w, h }) {
    for (let xx = x; xx < x + w; xx++) for (const yy of [y - 1, y + h]) if (this.tiles.get(xx,
      yy) === "." && this.tiles.get(xx - 1, yy) === "#" && this.tiles.get(xx + 1,
      yy) === "#") this.tiles.set(xx, yy, "+");
  }
  open(x, y) {
    const t = this.tiles.get(x, y);
    return t !== undefined && t !== "#";
  }
  clear(x, y) {
    const t = this.tiles.get(x, y);
    return t !== undefined && t !== "#" && t !== "+";
  }
  place(item, x, y) {
    const k = `${x},${y}`;
    const l = this.items.get(k);
    if (l) l.push(item);
    else this.items.set(k, [item]);
  }
  take(x, y) {
    const k = `${x},${y}`, l = this.items.get(k);
    if (!l) return null;
    const item = l.pop();
    if (!l.length) this.items.delete(k);
    return item;
  }
  spot() {
    const r = this.dice.pick(this.rooms);
    return [this.dice.int(r.x, r.x + r.w - 1), this.dice.int(r.y, r.y + r.h - 1)];
  }
  text(actors = []) {
    const rows = Array.from({ length: this.tiles.height }, () => "");
    for (const [x, y, t] of this.tiles) {
      const a = actors.find(a => a.x === x && a.y === y);
      rows[y] += a ? a.mark : this.items.has(`${x},${y}`) ? "!" : t;
    }
    return rows.join("\n");
  }
  path([x, y], [tx, ty], blocked = () => false) {
    const key = (a, b) => b * this.tiles.width + a;
    const cost = new Map([[key(x, y), 0]]), via = new Map(), queue = [[0, x, y]];
    let visited = 0;
    while (queue.length) {
      let best = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[best][0]) best = i;
      const [, cx, cy] = queue.splice(best, 1)[0];
      visited++;
      if (cx === tx && cy === ty) {
        const out = [];
        for (let k = key(tx,
          ty); via.has(k); k = via.get(k)) out.unshift([k % this.tiles.width,
          Math.floor(k / this.tiles.width)]);
        return {
          steps: out, visited
      };
      }
      for (const d in DIRECTIONS) {
        const [dx, dy] = DIRECTIONS[d], nx = cx + dx, ny = cy + dy;
        if (!this.open(nx, ny) || (blocked(nx, ny) && !(nx === tx && ny === ty))) continue;
        const c = cost.get(key(cx, cy)) + (dx && dy ? 1.4 : 1);
        if (c < (cost.get(key(nx, ny)) ?? Infinity)) {
          cost.set(key(nx, ny), c);
          via.set(key(nx, ny), key(cx, cy));
          queue.push([c + Math.max(Math.abs(nx - tx), Math.abs(ny - ty)), nx, ny]);
        }
      }
    }
    return {
      steps: null, visited
  };
  }
  sight(x, y, radius) {
    const out = new Set([`${x},${y}`]);
    for (let i = 0; i < 72; i++) {
      const a = (i * Math.PI) / 36, dx = Math.cos(a), dy = Math.sin(a);
      let px = x + 0.5, py = y + 0.5;
      for (let k = 0; k < radius; k++) {
        px += dx;
        py += dy;
        const cx = Math.floor(px), cy = Math.floor(py);
        if (!this.tiles.has(cx, cy)) break;
        out.add(`${cx},${cy}`);
        if (!this.clear(cx, cy)) break;
      }
    }
    return out;
  }
}
const ITEMS = {
  potion: {
    weight: 4, use(who, game) {
      const n = game.dice.roll("2d4+2");
      who.heal(n);
      return `${who.name} heals ${n}`;
    }
}, scroll: {
    weight: 2, use(who, game) {
      const [x, y] = game.level.spot();
      who.x = x;
      who.y = y;
      return `${who.name} is elsewhere`;
    }
}, sword: {
    weight: 1, use(who) {
      who.power += 2;
      return `${who.name} is armed (${who.power})`;
    }
}, bomb: {
    weight: 1, use(who, game) {
      let n = 0;
      for (const a of [...game.actors]) if (a !== who && Math.max(Math.abs(a.x - who.x),
        Math.abs(a.y - who.y)) <= 2) {
        a.hurt(game.dice.roll("3d4"), who, game);
        n++;
      }
      return `${who.name} bombs ${n}`;
    }
  }
};
class Actor {
  static #next = 1;
  energy = 0;
  effects = [];
  pack = [];
  constructor(name, mark, { hp, power, speed, armor = 0 }) {
    this.id = Actor.#next++;
    this.name = name;
    this.mark = mark;
    this.hp = this.max = hp;
    this.power = power;
    this.speed = speed;
    this.armor = armor;
    this.x = this.y = 0;
    this.kills = 0;
  }
  static reset() {
    Actor.#next = 1;
  }
  get alive() {
    return this.hp > 0;
  }
  heal(n) {
    this.hp = Math.min(this.max, this.hp + n);
  }
  hurt(n, by, game) {
    const real = Math.max(1, n - this.armor);
    this.hp -= real;
    game.say(`${by.name} hits ${this.name} for ${real}`);
    if (!this.alive) {
      by.kills++;
      game.dead(this, by);
    }
  }
  attack(o, game) {
    if (game.dice.chance(0.15)) {
      game.say(`${this.name} misses ${o.name}`);
      return;
    }
    o.hurt(game.dice.int(1, this.power), this, game);
    this.onHit?.(o, game);
  }
  step(dx, dy, game) {
    const x = this.x + dx, y = this.y + dy;
    if (!game.level.open(x, y)) return false;
    const other = game.at(x, y);
    if (other) {
      if (other.side !== this.side) this.attack(other, game);
      return other.side !== this.side;
    }
    this.x = x;
    this.y = y;
    return true;
  }
  tick(game) {
    for (const e of [...this.effects]) {
      e.run(this, game);
      if (--e.turns <= 0) this.effects.splice(this.effects.indexOf(e), 1);
    }
  }
  act() {
  }
  get side() {
    return "monster";
  }
}
class Rat extends Actor {
  constructor() {
    super("rat", "r", { hp: 6, power: 3, speed: 12 });
  }
  act(game) {
    const h = game.hero;
    if (game.sees(this, h)) game.approach(this, h);
    else game.wander(this);
  }
}
class Orc extends Actor {
  constructor() {
    super("orc", "o", { hp: 14, power: 6, speed: 8, armor: 1 });
  }
  act(game) {
    if (this.hp < 5) game.flee(this, game.hero);
    else if (game.sees(this, game.hero)) game.approach(this, game.hero);
    else game.wander(this);
  }
}
class Snake extends Actor {
  constructor() {
    super("snake", "s", { hp: 8, power: 2, speed: 14 });
  }
  act(game) {
    if (game.sees(this, game.hero) || game.dice.chance(0.3)) game.approach(this, game.hero);
  }
  onHit(o) {
    if (!o.effects.some(e => e.name === "poison")) o.effects.push({ name: "poison", turns: 4,
      run: (who, game) => {
      who.hp -= 1;
      game.say(`${who.name} suffers`);
      if (!who.alive) game.dead(who, { name: "poison", kills: 0 });
    }
  });
  }
}
class Hero extends Actor {
  constructor(name) {
    super(name, "@", { hp: 40, power: 8, speed: 10, armor: 1 });
    this.plan = [];
  }
  get side() {
    return "hero";
  }
  act(game) {
    const near = game.actors.filter(a => a !== this && Math.max(Math.abs(a.x - this.x),
      Math.abs(a.y - this.y)) <= 1);
    if (this.hp < 12) {
      const i = this.pack.findIndex(n => n === "potion");
      if (i >= 0) {
        game.use(this, i);
        return;
      }
    }
    if (near.length > 2) {
      const i = this.pack.indexOf("bomb");
      if (i >= 0) {
        game.use(this, i);
        return;
      }
    }
    if (near.length) {
      const weakest = near.reduce((a, b) => (b.hp < a.hp ? b : a));
      this.attack(weakest, game);
      return;
    }
    const item = game.level.take(this.x, this.y);
    if (item) {
      this.pack.push(item);
      game.say(`${this.name} takes ${item}`);
      if (item === "sword") game.use(this, this.pack.indexOf("sword"));
      return;
    }
    if (game.level.tiles.get(this.x, this.y) === ">") {
      game.descend();
      return;
    }
    const targets = [...game.level.items.keys()].map(k => k.split(",").map(Number));
    const stairs = game.level.rooms.at(-1).center;
    const goal = targets.sort((a, b) => Math.hypot(a[0] - this.x,
      a[1] - this.y) - Math.hypot(b[0] - this.x, b[1] - this.y))[0] ?? stairs;
    const {
      steps
  } = game.level.path([this.x, this.y], goal, (x, y) => game.at(x, y) !== undefined);
    if (steps?.length) this.step(steps[0][0] - this.x, steps[0][1] - this.y, game);
    else game.wander(this);
  }
}
class Game {
  constructor(seed, name = "hero") {
    Actor.reset();
    this.seed = seed;
    this.dice = new Dice(seed);
    this.log = [];
    this.turn = 0;
    this.over = null;
    this.hero = new Hero(name);
    this.level = null;
    this.deaths = {
  };
    this.enter(1);
  }
  enter(depth) {
    this.level = new Level(44, 18, this.dice, depth);
    this.actors = [this.hero];
    [this.hero.x, this.hero.y] = this.level.rooms[0].center;
    const kinds = [[Rat, 5], [Orc, depth], [Snake, 2]];
    for (let i = 0; i < 4 + depth * 2; i++) {
      const K = this.dice.weighted(kinds);
      const a = new K();
      for (let t = 0; t < 20; t++) {
        const [x, y] = this.level.spot();
        if (!this.at(x, y) && Math.hypot(x - this.hero.x, y - this.hero.y) > 6) {
          a.x = x;
          a.y = y;
          this.actors.push(a);
          break;
        }
      }
    }
    for (let i = 0; i < 5; i++) this.level.place(this.dice.weighted(Object.entries(ITEMS).map(([n,
      { weight }]) => [n, weight])), ...this.level.spot());
  }
  say(text) {
    this.log.push(`${this.turn}: ${text}`);
  }
  at(x, y) {
    return this.actors.find(a => a.x === x && a.y === y);
  }
  sees(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) < 9 && this.level.sight(a.x, a.y,
      9).has(`${b.x},${b.y}`);
  }
  approach(a, b) {
    const {
      steps
  } = this.level.path([a.x, a.y], [b.x, b.y], (x, y) => this.at(x, y) !== undefined);
    if (steps?.length) a.step(steps[0][0] - a.x, steps[0][1] - a.y, this);
  }
  flee(a, b) {
    let best = null;
    for (const d of Object.values(DIRECTIONS)) {
      const x = a.x + d[0], y = a.y + d[1];
      if (!this.level.open(x, y) || this.at(x, y)) continue;
      const far = Math.hypot(x - b.x, y - b.y);
      if (!best || far > best.far) best = {
        d, far
    };
    }
    if (best) a.step(...best.d, this);
  }
  wander(a) {
    a.step(...this.dice.pick(Object.values(DIRECTIONS)), this);
  }
  use(who, i) {
    const [name] = who.pack.splice(i, 1);
    this.say(ITEMS[name].use(who, this));
  }
  dead(a, by) {
    if (a === this.hero) {
      this.over = `killed by ${by.name} on ${this.level.depth}`;
      return;
    }
    this.actors = this.actors.filter(x => x !== a);
    this.deaths[a.name] = (this.deaths[a.name] ?? 0) + 1;
    this.say(`${a.name} dies`);
    if (this.dice.chance(0.2)) this.level.place("potion", a.x, a.y);
  }
  descend() {
    this.hero.heal(10);
    this.say("down to " + (this.level.depth + 1));
    if (this.level.depth >= 5) {
      this.over = "escaped";
      return;
    }
    this.enter(this.level.depth + 1);
  }
  step() {
    this.turn++;
    for (const a of [...this.actors]) {
      if (this.over) return;
      if (!a.alive || !this.actors.includes(a)) continue;
      a.energy += a.speed;
      while (a.energy >= 10 && !this.over && a.alive) {
        a.energy -= 10;
        a.act(this);
        a.tick(this);
      }
    }
  }
  run(limit) {
    while (!this.over && this.turn < limit) this.step();
    return this;
  }
  save() {
    return JSON.stringify({ seed: this.seed, turn: this.turn, depth: this.level.depth,
      hero: { hp: this.hero.hp, at: [this.hero.x, this.hero.y], pack: this.hero.pack },
      rolled: this.dice.rolled });
  }
  static replay(text) {
    const s = JSON.parse(text);
    const g = new Game(s.seed).run(s.turn);
    if (g.save() !== text) throw new Error("replay differs: " + g.save());
    return g;
  }
}
const shown = new Level(44, 18, new Dice(5));
console.log(shown.text());
console.log(shown.rooms.length, shown.tiles.count(t => t === "."),
  shown.tiles.count(t => t === "+"), shown.path(shown.rooms[0].center,
  shown.rooms.at(-1).center).steps.length, shown.sight(...shown.rooms[0].center, 8).size);
let total = 0;
const ends = {
};
for (let seed = 1; seed <= 26; seed++) {
  const g = new Game(seed * 7919).run(400);
  ends[(g.over ?? "going on").replace(/\d+$/,
    "N")] = (ends[(g.over ?? "going on").replace(/\d+$/, "N")] ?? 0) + 1;
  total = (total * 31 + g.log.length + g.dice.rolled + g.hero.hp + 100) >>> 0;
  if (seed <= 4) {
    console.log(seed, g.over, g.turn, g.level.depth, g.hero.hp, g.hero.kills,
      g.hero.pack.join("+"), JSON.stringify(g.deaths), g.log.length);
    console.log(g.log.slice(0, 4).join(" | "), "...", g.log.slice(-2).join(" | "));
    if (seed === 2) console.log(Game.replay(g.save()).log.length === g.log.length,
      g.level.text(g.actors).split("\n").slice(4, 9).join("\n"));
  }
}
console.log(total, JSON.stringify(Object.entries(ends).sort()));
const dice = new Dice(3);
console.log([1, 2, 3, 4].map(() => dice.roll("3d6-2")).join(), dice.pick(["a", "b"]),
  dice.weighted([["x", 0], ["y", 1]]));
for (const bad of [() => dice.roll("x"), () => shown.tiles.set(-1, 0, "."),
  () => Game.replay('{"seed":7919,"turn":3}')]) try {
  bad();
} catch (e) {
  console.log(e.name, e.message.slice(0, 40));
}
