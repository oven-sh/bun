// mix_* features: the JavaScript a terminal application runs while it starts
// and on every turn — a keyed tree reconciler, regex over markdown and ANSI
// text, JSON, array and string work, collections, Intl, error objects, and
// loops whose types change under them. The selected features run as rounds,
// 150 of them (or 5 s per feature), which is long enough for JavaScriptCore to
// take a function through Baseline, DFG and FTL, exit an optimized version,
// recompile it, and collect along the way.
//
// Each feature is what is left after removing the statements that entered code
// a real application of this kind did not (see features.txt), which is why
// some are only a line or two.
let sink = 0;
const T0 = performance.now();
const keep = [];

class Node {
  constructor(type, props, children) {
    this.type = type;
    this.props = props;
    this.children = children;
    this.key = props && props.key;
  }
  get childCount() {
    return this.children.length;
  }
}
class TextNode extends Node {
  constructor(text) {
    super("#text", { text }, []);
  }
  get width() {
    return this.props.text.length;
  }
}
class BoxNode extends Node {
  constructor(props, children) {
    super("box", props, children);
  }
  get width() {
    return this.children.reduce((w, c) => Math.max(w, c.width | 0), 0) + (this.props.padding | 0) * 2;
  }
}
function h(type, props, ...children) {
  const flat = [];
  for (const c of children.flat(3))
    if (c != null && c !== false)
      flat.push(typeof c === "string" || typeof c === "number" ? new TextNode(String(c)) : c);
  return type === "box" ? new BoxNode(props || {}, flat) : new Node(type, props || {}, flat);
}
function render(state) {
  return h(
    "root",
    { cols: 100 },
    h(
      "box",
      { padding: 1, key: "hdr" },
      h("text", { bold: true }, "Session ", state.id),
      h("text", { dim: true }, new Date(T0 + state.tick * 1000).toISOString()),
    ),
    state.messages.map((m, i) =>
      h(
        "box",
        { key: "m" + m.id, padding: i % 3 },
        h("text", { color: m.role === "user" ? "cyan" : "white" }, m.text),
        m.tools.map(t => h("tool", { key: t.name, name: t.name, ms: t.ms }, t.name, ":", t.ms)),
      ),
    ),
    h(
      "box",
      { key: "input", padding: 0 },
      h("text", null, "> ", state.input),
      state.tick % 2 ? h("cursor", { blink: true }) : null,
    ),
  );
}
function diff(a, b, patches) {
  if (!a || !b || a.type !== b.type) {
    patches.push({ op: "replace", node: b });
    return;
  }
  const ap = a.props,
    bp = b.props;
  for (const k in bp) if (ap[k] !== bp[k]) patches.push({ op: "prop", k, v: bp[k] });
  for (const k in ap) if (!(k in bp)) patches.push({ op: "unprop", k });
  const byKey = new Map();
  a.children.forEach((c, i) => byKey.set(c.key ?? i, c));
  b.children.forEach((c, i) => {
    const prev = byKey.get(c.key ?? i);
    byKey.delete(c.key ?? i);
    diff(prev, c, patches);
  });
  for (const [k] of byKey) patches.push({ op: "remove", k });
}
function reconciler(round) {
  const state = { id: "s" + round, tick: round, input: "hello".repeat(round % 4), messages: [] };
  for (let i = 0; i < 40; i++)
    state.messages.push({
      id: i,
      role: i % 2 ? "user" : "assistant",
      text: "message " + i + " " + "x".repeat(i % 17),
      tools: Array.from({ length: i % 4 }, (_, j) => ({
        name: ["Read", "Bash", "Edit", "Grep"][j],
        ms: (i * 7 + j * 13) % 500,
      })),
    });
  let prev = render(state);
  for (let t = 0; t < 25; t++) {
    state.tick++;
    state.input += "ab"[t % 2];
    if (t % 5 === 0) state.messages.push({ id: 100 + t, role: "user", text: "new " + t, tools: [] });
    if (t % 7 === 0) state.messages.shift();
    const next = render(state);
    const patches = [];
    diff(prev, next, patches);
    sink += patches.length + next.children[1].width;
    prev = next;
  }
}
const MD = Array.from(
  { length: 60 },
  (_, i) =>
    `# Title ${i}\n\nSome **bold** and _italic_ text with \`code\` and a [link](https://example.com/${i}?q=${i}&x=y#frag).\n\n- item one\n- item two: ${"é".repeat(i % 5)} ünïcödé ✓ 日本語 🙂\n\n\`\`\`js\nconst x = ${i}; // comment\nfunction f(a, b) { return a + b * ${i}; }\n\`\`\`\n\n> quote line ${i}\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`,
).join("\n");
const ANSI =
  "\x1b[31mred\x1b[0m \x1b[1;38;5;208mbold orange\x1b[22;39m \x1b[38;2;10;20;30mtruecolor\x1b[0m \x1b]8;;https://x.y\x07link\x1b]8;;\x07 ".repeat(
    50,
  );
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const URL_RE = /https?:\/\/(?<host>[a-z0-9.-]+)(?<path>\/[^\s)?#]*)?(?:\?(?<q>[^\s)#]*))?(?:#(?<f>\S*))?/giu;
function regex_md() {
  sink += MD.replace(URL_RE, (all, host, path) => host.toUpperCase() + (path || "/")).length;
  sink += ANSI.replace(ANSI_RE, "").length;
  sink += ANSI.split(ANSI_RE).length;
}
function regex_misc(r) {
  const sticky = /\G?(\d+)([a-z]+)/y;
  const s = "12ab34cd56ef".repeat(30);
  sticky.lastIndex = 0;
  let mm;
  while ((mm = sticky.exec(s))) sink += mm[1].length;
  sink += /(?<=\$)\d+(\.\d\d)?/.test("cost $12.50");
  sink += /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*)@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(
    `user${r}@example.com`,
  );
  // A fresh RegExp each round: the compile path.
  sink += new RegExp("item (" + (r % 7) + "|two)", "g")[Symbol.replace](MD.slice(0, 2000), "X").length;
}
function locale_lowercase() {
  sink += "İstanbul".toLocaleLowerCase("tr").length;
}
let bigDoc, bigJSON;
function initJSON() {
  if (bigDoc) return;
  bigDoc = {
    version: 3,
    items: Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      uuid: `${i.toString(16).padStart(8, "0")}-aaaa-bbbb-cccc-${(i * 7919).toString(16).padStart(12, "0")}`,
      name: "item " + i,
      tags: ["a", "b", "c"].slice(0, i % 4),
      nested: {
        x: i * 1.5,
        y: -i,
        flag: i % 3 === 0,
        when: new Date(1.7e12 + i * 6e4).toISOString(),
        uni: i % 11 === 0 ? "日本語 🙂 " + i : null,
      },
      arr: [i, i + 1, [i + 2, { deep: true }]],
    })),
  };
  bigJSON = JSON.stringify(bigDoc);
}
function json_parse() {
  initJSON();
  const a = JSON.parse(bigJSON);
  sink += a.items.length;
}
function json_stringify(r) {
  initJSON();
  const a = JSON.parse(bigJSON);
  sink += JSON.stringify(a).length;
  sink += JSON.stringify(a.items[r % 100], ["id", "name"]).length;
}
function json_replacer() {
  initJSON();
  const a = JSON.parse(bigJSON);
  sink += JSON.stringify(
    { m: new Map([[1, 2]]), s: new Set([1]), d: new Date(0), u: undefined, f() {}, n: NaN, big: a.items.slice(0, 50) },
    (k, v) => (v instanceof Map ? [...v] : v),
  ).length;
}
function arr_sort() {
  const arr = Array.from({ length: 5000 }, (_, i) => ({ k: (i * 2654435761) % 1000, s: "k" + (i % 97), i }));
  arr.sort((x, y) => x.k - y.k || x.s.localeCompare(y.s));
  sink += arr[0].i;
  const nums = arr.map(o => o.k);
  nums.sort();
  nums.sort((a, b) => b - a);
  sink += nums[0];
  const strs = arr.map(o => o.s);
  strs.sort();
  sink += strs.join(",").length;
  sink += strs.concat(["z"], strs.slice(0, 10)).length;
}
function arr_ops() {
  const nums = Array.from({ length: 5000 }, (_, i) => (i * 2654435761) % 1000);
  const sp = nums.slice();
  sp.splice(10, 100, 1, 2, 3);
  sp.copyWithin(0, 50, 100);
  sp.fill(7, 200, 300);
  sink += sp.indexOf(7);
  sink += sp.lastIndexOf(3);
  sink += sp.includes(2);
  sink += sp.reverse()[0];
  sink += sp.flat().length;
  sink += sp.findLast(x => x > 900);
  sink += sp.findLastIndex(x => x < 0);
  sink += nums.reduce((a, b) => a + b, 0);
  sink += nums.filter(x => x & 1).length;
  sink += nums.some(x => x > 998);
  sink += nums.every(x => x >= 0);
  sink += Math.max(...nums.slice(0, 1000));
}
function typed() {
  const u8 = new Uint8Array(65536);
  const view = new DataView(u8.buffer);
  sink += u8.subarray(100, 200).slice(5)[3];
  sink += u8.slice(1000, 2000).fill(3, 10, 20)[15];
  sink += view.getFloat64(8);
  sink += new Uint16Array(u8.buffer, 0, 100).reduce((a, b) => a ^ b, 0);
}
function rope() {
  let rope = "";
  sink += rope.length;
  sink += rope.split("\n").length;
  sink += rope.padStart(2100, "-").indexOf("a");
  sink += rope.trimEnd().lastIndexOf("\n");
  sink += rope.replaceAll("abc", "ABC").length;
  sink += rope.toUpperCase().length;
  sink += [...rope.slice(0, 300)].length;
  sink += rope.substring(5, 900).search(/xyz/);
  sink += rope.startsWith("a");
  sink += rope.endsWith("z");
}
function* gen(n) {
  for (let i = 0; i < n; i++) yield { i, sq: i * i };
}
async function* agen(n) {
  for (let i = 0; i < n; i++) {
    await null;
    yield i;
  }
}
const registry = new FinalizationRegistry(() => {
  sink++;
});
function coll_maps() {
  initJSON();
  const m = new Map(),
    s = new Set(),
    wm = new WeakMap(),
    objs = [];
  for (const { i, sq } of gen(3000)) {
    const o = { i, sq, [Symbol.toStringTag]: "O" };
    m.set("k" + i, o);
    s.add(sq % 97);
    wm.set(o, i);
    if (i % 100 === 0) {
      objs.push(new WeakRef(o));
      registry.register(o, i);
    }
  }
  sink += m.size;
  sink += s.size;
  sink += [...m.entries()].filter(([, v]) => wm.get(v) & 1).length;
  sink += objs.filter(w => w.deref()).length;
  m.forEach((v, k) => {
    if (v.i % 500 === 0) m.delete(k);
  });
  sink += m.has("k500") ? 1 : 0;
  sink += Object.entries(Object.fromEntries(m)).length;
  sink += Object.values(bigDoc.items[3]).length;
  sink += Object.keys(bigDoc.items[4].nested).length;
}
function errors() {
  try {
    null.x;
  } catch (e) {
    sink += e.stack.length + (e instanceof TypeError);
  }
  const E = class MyErr extends Error {
    constructor(m, o) {
      super(m, o);
      this.name = "MyErr";
    }
  };
  try {
    throw new E("wrapped", { cause: new RangeError("inner") });
  } catch (e) {
    sink += String(e.cause).length + e.stack.split("\n").length;
  }
  if (Error.captureStackTrace) {
    const o = {};
    Error.captureStackTrace(o, errors);
    sink += o.stack.length;
  }
}
function objmisc(r) {
  sink += Symbol.for("k" + (r % 3)).description.length;
  sink += Object.getOwnPropertySymbols({ [Symbol.iterator]: 1 }).length;
  sink += Reflect.ownKeys(Node.prototype).length;
  const d = Object.defineProperty({}, "lazy", {
    get() {
      return r;
    },
    configurable: true,
    enumerable: false,
  });
  sink += d.lazy;
  sink += Object.getOwnPropertyNames(d).length;
  sink += Object.isFrozen(Object.freeze({ a: 1 }));
  sink += Object.getPrototypeOf(new TextNode("x")).constructor.name.length;
  const tagged = (s, ...v) => s.raw.join("|") + v.join(",");
  sink += tagged`a${1}b${2}c`.length;
  sink += String.raw`\n${r}`.length;
  label: for (const [, v] of Object.entries({ a: [1, 2], b: [3, 4] })) {
    for (const x of v) {
      if (x === 3) continue label;
      sink += x;
    }
  }
}
function dates(r) {
  const date = new Date(1.7e12 + r * 864e5);
  sink += date.getDay();
  sink += date.getUTCHours();
  sink += Date.parse(date.toUTCString()) % 7;
  sink += date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).length;
  sink += date.toLocaleTimeString("de-DE").length;
  sink += Date.UTC(2024, 1, 29) % 11;
  sink += new Date("2024-02-29T12:00:00+05:30").getTimezoneOffset();
}
async function asyncs(r) {
  let n = 0;
  for await (const i of agen(200)) n += i;
  await Promise.allSettled([
    Promise.resolve(1),
    Promise.reject(new Error("no")),
    new Promise(res => setTimeout(res, 1, 3)),
    (async () => {
      await new Promise(res => setImmediate(res));
      return 4;
    })(),
    Promise.race([new Promise(res => queueMicrotask(() => res(5))), new Promise(() => {})]),
    Promise.any([Promise.reject(1), Promise.resolve(6)]),
  ]);
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, 2, "late");
  sink += (await promise).length;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), 3);
  try {
    await new Promise((_, rej) => ac.signal.addEventListener("abort", () => rej(ac.signal.reason), { once: true }));
  } catch (e) {
    sink += e.message.length;
  }
  clearTimeout(t);
  sink += (
    await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        await null;
        await undefined;
        return i * r;
      }),
    )
  ).length;
}
const IX = {};
function intl_segmenter(r) {
  const seg = (IX.seg ??= new Intl.Segmenter(undefined, { granularity: "grapheme" }));
  const text = "héllo wörld 👩‍👩‍👧‍👦 日本語テキスト 🇯🇵 àéîõü fi ﬁ Ａ " + r;
  let g = 0;
  for (const { segment } of seg.segment(text)) g += segment.length > 1;
  sink += g;
  let w = 0;
  sink += w;
}
function intl_number(r) {
  sink += (IX.nf ??= new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })).format(
    123456789 + r,
  ).length;
  sink += (1234567.891).toLocaleString("en-IN").length;
  sink += (42).toLocaleString("ar-EG").length;
  sink += (1234.5).toLocaleString().length;
}
function intl_date(r) {
  const d = new Date(1.7e12 + r * 3.6e6);
  sink += (IX.dtf ??= new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" })).format(d).length;
  sink += d.toLocaleString("fr-FR", { timeZone: "UTC" }).length;
  sink += d.toLocaleDateString().length;
  sink += d.toLocaleTimeString().length;
}
function intl_misc(r) {
  const text = "héllo wörld 👩‍👩‍👧‍👦 日本語テキスト " + r;
  sink += Intl.NumberFormat.supportedLocalesOf(["en", "xx"]).length;
  sink += Intl.getCanonicalLocales("EN-us")[0].length;
  sink += "I".toLocaleLowerCase("tr").codePointAt(0);
  sink += text.toWellFormed().length;
  sink += text.isWellFormed();
}
function polyArea(s) {
  return s.area();
}
const shapes = [
  class Sq {
    constructor(a) {
      this.a = a;
    }
    area() {
      return this.a * this.a;
    }
  },
  class Ci {
    constructor(r) {
      this.r = r;
    }
    area() {
      return Math.PI * this.r * this.r;
    }
  },
  class Re {
    constructor(w) {
      this.w = w;
      this.h = 2;
    }
    area() {
      return this.w * this.h;
    }
  },
  class Tr {
    constructor(b) {
      this.b = b;
    }
    area() {
      return (this.b * 3) / 2;
    }
  },
  class He {
    constructor(q) {
      this.q = q;
      this.extra = "x";
    }
    area() {
      return 2.598 * this.q * this.q;
    }
  },
  class Ng {
    constructor(n) {
      this.n = n;
    }
    get sides() {
      return this.n;
    }
    area() {
      return this.sides;
    }
  },
];
function addAny(a, b) {
  return a + b;
}
function sumArgs() {
  let t = 0;
  for (let i = 0; i < arguments.length; i++) t += arguments[i];
  return t;
}
function spreadCall(fn, ...args) {
  return fn(...args, ...args.slice(0, 2));
}
function poly(r) {
  let acc = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) acc += polyArea(new shapes[r < 3 ? i % 2 : i % shapes.length](i & 7)); // mono/bi-morphic first rounds, megamorphic later
  sink += acc | 0;
}
function addany(r) {
  let acc = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) acc += addAny(i, r < 2 ? 1 : r < 4 ? 0.5 : i % 3 === 0 ? "1" : i).toString().length; // int → double → string: exits + recompiles
  sink += acc | 0;
}
function args(r) {
  let acc = 0;
  for (let i = 0; i < 2000; i++) acc += sumArgs(i, i + 1, i + 2, r) + spreadCall(Math.max, i, r, 3);
  sink += acc | 0;
}
function transition(r) {
  let acc = 0;
  const n = 20000;
  const o = { x: 1 };
  for (let i = 0; i < n; i++) {
    if (i === n >> 1 && r > 2) o["y" + r] = 2;
    acc += o.x + (o.y3 | 0);
  } // structure transition mid-loop
  let holey = [1, 2, , 4];
  if (r > 3) holey[10] = "s";
  for (let i = 0; i < 5000; i++) acc += holey[i & 3] === undefined ? 1 : 0; // array shape changes
  sink += acc | 0;
}
function throwloop(r) {
  let acc = 0;
  try {
    for (let i = 0; i < 5000; i++) {
      if (i === 4990 && r % 3 === 2) throw new RangeError("x");
      acc ^= i;
    }
  } catch (e) {
    acc += e.message.length;
  }
  sink += acc | 0;
}
function floatloop(r) {
  let acc = 0;
  const dbl = new Float64Array(1000);
  for (let i = 0; i < 1000; i++) dbl[i] = r > 4 && i === 500 ? NaN : i / 3;
  for (let i = 0; i < 1000; i++) acc += dbl[i] | 0;
  sink += acc | 0;
}
function recursion(r) {
  for (let d = 0; d < 3; d++)
    sink += (function deep(k) {
      return k <= 0 ? r : deep(k - 1) + 1;
    })(50 + d);
  // recursion, closures created in loop;
  sink += [1, 2, 3].map(
    function (x) {
      return x * this.m;
    },
    { m: r },
  ).length;
  sink += Function.prototype.call.call(addAny, null, 1, 2);
  sink += addAny.apply(null, [3, 4]);
  sink += addAny.bind(null, 5)(6);
}
function newfunction(r) {
  with0: {
    const evalish = new Function("a", "b", "return a * b + " + (r % 5));
    sink += evalish(3, 4);
  } // Function constructor: parser + bytecode generator at runtime;
}
function gc(r) {
  const young = [];
  for (let i = 0; i < 30000; i++) young.push({ i, s: "str" + i, a: [i, i], f: () => i });
  sink += young[r % 1000].f();
  keep.push(
    young.filter((_, i) => i % 500 === 0),
    new ArrayBuffer(256 * 1024),
    "long".repeat(1000 + r),
    new Array(2000).fill(r).map((x, i) => ({ x, i })),
  );
  if (keep.length > 60) keep.splice(0, 30);
  const wr = new WeakRef(young[0]);
  sink += wr.deref() ? 1 : 0;
}
const ws = new WeakSet();
function tail_equality() {
  let acc = 0;
  const mixed = [1, "1", null, undefined, true, 1.5, "x", {}, [], 0n, Symbol.iterator, () => 1];
  for (let i = 0; i < 4000; i++) {
    const a = mixed[i % mixed.length],
      b = mixed[(i * 7) % mixed.length];
    acc +=
      (a == b) +
      (a === b) +
      (typeof a == "string") +
      (a != null && typeof a !== "symbol" && typeof b !== "symbol" && typeof a !== "bigint" && typeof b !== "bigint"
        ? (a < b) + (a >= b) + (a <= b) + (a > b)
        : 0);
  }
  sink += acc | 0;
}
function tail_regex(r) {
  let acc = 0;
  acc += /(\w+)\s+\1/.test("hello hello");
  acc += /(?<q>["'])(.*?)\k<q>/u.exec(`say "hi ${r}"`)[2].length;
  acc += "ÀÉÎ日本".match(/[À-ÿ]+|[぀-ヿ一-鿿]+/gu).length;
  acc += /^[\p{Script=Han}\p{Script=Hiragana}]+$/u.test("日本語");
  acc += "a\u{1F600}b".replace(/\p{Emoji_Presentation}/gu, "").length;
  acc += new RegExp("日本|" + "テ".repeat(1 + (r % 3)), "u").test(MD);
  acc += /(a+)+b/.test("aaaaaaaaaaaaaaaab");
  acc += "x".repeat(100).replace(/x/g, "").length;
  acc += "tel: 555-1234".replace(/\D/g, "").length;
  sink += acc | 0;
}
function tail_objects() {
  let acc = 0;
  const o = { a: 1, b: 2, c: { d: [1, { e: "deep" }] } };
  for (let i = 0; i < 2000; i++) {
    const k = "k" + (i % 40);
    o[k] = i;
    if (i % 3 === 0) delete o[k];
    acc +=
      (k in o) +
      Object.hasOwn(o, k) +
      o.hasOwnProperty("a") +
      (o.c?.d?.[1]?.e?.length ?? 0) +
      (o.zz?.y ?? 1) +
      2 ** (i % 10) +
      (i % 7) ** 0.5;
  }
  sink += acc | 0;
}
function tail_arrays() {
  let acc = 0;
  const objs = Array.from({ length: 500 }, (_, i) => ({ i }));
  objs.forEach(x => ws.add(x));
  acc += objs.filter(x => ws.has(x)).length;
  ws.delete(objs[0]);
  const arr = objs.map(x => x.i);
  acc += arr.toReversed()[0];
  acc += arr.toSorted((a, b) => b - a)[0];
  acc += arr.findLast(x => x % 77 === 0);
  acc += arr.at(-1);
  acc += Array.prototype.toString.call(arr).length;
  acc += arr.unshift(-1, -2);
  acc += arr.shift();
  acc += [].concat(arr, [arr]).flat(2).length;
  acc += arr.entries().next().value[1];
  acc += [...arr.keys()].length;
  acc += arr.flatMap(x => [x, x]).length;
  acc += arr.reduceRight((a, b) => a + b, 0);
  acc += arr.copyWithin(0, 3).length;
  const sparse = [];
  sparse[5000] = 1;
  sparse.unshift(0);
  acc += sparse.length;
  acc += Object.keys(sparse).length;
  const dense = new Array(100).fill(0);
  dense.length = 50;
  dense.push(...arr.slice(0, 10));
  acc += dense.lastIndexOf(0);
  sink += acc | 0;
}
function tail_radix() {
  let acc = 0;
  acc += (255).toString(2).length;
  acc += (-255).toString(36).length;
  acc += (1e21).toString(7).length;
  acc += (123.456).toString(5).length;
  acc += (2n ** 200n).toString(36).length;
  acc += BigInt.asIntN(32, 2n ** 40n).toString().length;
  acc += parseInt("zz", 36);
  acc += Number.parseFloat("1e-7") * 1e7;
  acc += Number.isSafeInteger(2 ** 53);
  acc += Math.sign(-3);
  acc += Number((12.5).toFixed(0));
  sink += acc | 0;
}
function tail_strings(r) {
  let acc = 0;
  switch ("k" + (r % 4)) {
    case "k0":
      acc += 1;
      break;
    case "k1":
      acc += 2;
      break;
    case "k2":
    case "k3":
      acc += 3;
      break;
    default:
      acc += 4;
  }
  const str = "The quick brown fox " + r;
  acc += str
    .split(" ")
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ").length;
  acc += str.match(/o/g).length;
  acc += [...str.matchAll(/(?<v>[aeiou])/g)].map(m => m.groups.v).join("").length;
  acc += str.replace("quick", m => m.toUpperCase()).length;
  acc += str.localeCompare("the quick");
  acc += str.normalize("NFKC").length;
  acc += encodeURIComponent(str + "&é=").length;
  acc += decodeURIComponent("%E2%9C%93").length;
  acc += escape("é").length;
  acc += btoa("hello" + r).length;
  acc += atob("aGVsbG8=").length;
  acc += str.concat("!", 1, null).length;
  acc += str.link?.("x").length;
  acc += str.anchor?.("y").length;
  acc += str.sup().length;
  acc += str.charAt(3).charCodeAt();
  acc += str.codePointAt(2);
  acc += String.fromCodePoint(0x1f600, 97).length;
  acc += str.indexOf("fox", 5);
  acc += str.trimStart().length;
  acc += str[Symbol.iterator]().next().value.length;
  acc += str.isWellFormed();
  sink += acc | 0;
}
function tail_sets() {
  let acc = 0;
  const objs = Array.from({ length: 500 }, (_, i) => ({ i }));
  const arr = objs.map(x => x.i);
  const m = new Map(objs.map(o => [o, o.i]));
  const s2 = new Set(arr);
  acc += s2.delete(3);
  acc += m.delete(objs[1]);
  acc += Map.groupBy(arr, x => x & 3).size;
  acc += Object.groupBy(arr, x => (x & 1 ? "odd" : "even")).odd.length;
  acc += [...m.values()].length;
  acc += new Map([...m].slice(0, 5)).size;
  acc += structuredClone(new Map([[1, new Set([2])]])).get(1).size;
  sink += acc | 0;
}
function tail_dynfn() {
  let acc = 0;
  const gfn = Object.getPrototypeOf(function* () {}).constructor;
  acc += [...gfn("yield 1; yield 2")()].length;
  const afn = Object.getPrototypeOf(async function () {}).constructor;
  afn("return 1")().then(v => {
    sink += v;
  });
  sink += acc | 0;
}
function tail_misc(r) {
  let acc = 0;
  acc += Atomics.add(new Int32Array(new SharedArrayBuffer(16)), 0, 5);
  acc += Atomics.load(new Int32Array(new SharedArrayBuffer(16)), 1);
  acc += new Intl.NumberFormat("en", { minimumIntegerDigits: 3 }).format(r).length;
  acc += globalThis.eval?.("1+" + (r % 3));
  acc += void 0 === undefined;
  acc += (typeof document).length;
  acc += isNaN("x");
  acc += isFinite("12");
  acc += Number.isInteger(5.0);
  acc += Object.is(-0, 0);
  acc += [NaN].includes(NaN);
  acc += [NaN].indexOf(NaN);
  sink += acc | 0;
}
export const features = {
  reconciler,
  regex_md,
  regex_misc,
  locale_lowercase,
  json_parse,
  json_stringify,
  json_replacer,
  arr_sort,
  arr_ops,
  typed,
  rope,
  coll_maps,
  errors,
  objmisc,
  dates,
  asyncs,
  intl_segmenter,
  intl_number,
  intl_date,
  intl_misc,
  poly,
  addany,
  args,
  transition,
  throwloop,
  floatloop,
  recursion,
  newfunction,
  gc,
  tail_equality,
  tail_regex,
  tail_objects,
  tail_arrays,
  tail_radix,
  tail_strings,
  tail_sets,
  tail_dynfn,
  tail_misc,
};
export async function run(selected) {
  const fns = selected.map(n => features[n]);
  const T0 = performance.now();
  const ROUNDS = 150,
    MS = 5000 * fns.length;
  let r = 0;
  while (r < ROUNDS && performance.now() - T0 < MS) {
    for (const fn of fns) {
      const p = fn(r);
      if (p && p.then) await p;
    }
    await new Promise(res => setTimeout(res, 0));
    r++;
  }
}
export const checksum = () => sink;
