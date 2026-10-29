// `o.w = v`, not `o.w += v`: numbers and booleans are stored into fields of a class, on objects whose field was never assigned, deleted, frozen, redefined, hidden behind another prototype or filled with a value of another kind.
class P {
  w!: number;
  h: number = 2;
  b!: boolean;
  constructor(public id: number) {}
}
class Q extends P {
  d!: number;
  constructor(id: number) {
    super(id);
  }
}
function put(o: P, v: number) {
  o.w = v;
  return o.w;
}
function putB(o: P, v: boolean) {
  o.b = v;
  return o.b;
}
function putD(o: Q, v: number) {
  o.d = v;
  o.w = v + 1;
  return o.d + o.w;
}
function putAny(o: any, v: any) {
  o.w = v;
  return o.w;
}
function show(label: string, o: any) {
  const d = Object.getOwnPropertyDescriptor(o, "w");
  console.log(
    label,
    JSON.stringify(o),
    Object.keys(o).join(),
    d ? [d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set, String(d.value)].join() : "none",
  );
}
const makers: [string, () => any][] = [
  ["fresh", () => new P(1)],
  [
    "assigned",
    () => {
      const o = new P(2);
      o.w = 5;
      return o;
    },
  ],
  [
    "deleted",
    () => {
      const o: any = new P(3);
      delete o.w;
      return o;
    },
  ],
  [
    "deleted-then-proto-setter",
    () => {
      const o: any = new P(4);
      delete o.w;
      Object.setPrototypeOf(o, {
        set w(v: number) {
          console.log("setter", v);
        },
        get w() {
          return -1;
        },
      });
      return o;
    },
  ],
  [
    "deleted-then-proto-readonly",
    () => {
      const o: any = new P(5);
      delete o.w;
      Object.setPrototypeOf(o, Object.freeze({ w: 9 }));
      return o;
    },
  ],
  ["frozen", () => Object.freeze(new P(6))],
  ["sealed", () => Object.seal(new P(7))],
  [
    "not-extensible-deleted",
    () => {
      const o: any = new P(8);
      delete o.w;
      return Object.preventExtensions(o);
    },
  ],
  [
    "own-accessor",
    () => {
      const o: any = new P(9);
      let k = 0;
      Object.defineProperty(o, "w", {
        get() {
          return k;
        },
        set(v) {
          k = v * 2;
        },
        configurable: true,
        enumerable: true,
      });
      return o;
    },
  ],
  [
    "read-only",
    () => {
      const o: any = new P(10);
      Object.defineProperty(o, "w", { value: 3, writable: false });
      return o;
    },
  ],
  [
    "not-enumerable",
    () => {
      const o: any = new P(11);
      Object.defineProperty(o, "w", { value: 3, enumerable: false });
      return o;
    },
  ],
  [
    "holds-a-text",
    () => {
      const o: any = new P(12);
      o.w = "text";
      return o;
    },
  ],
  [
    "holds-null",
    () => {
      const o: any = new P(13);
      o.w = null;
      return o;
    },
  ],
  [
    "holds-nan",
    () => {
      const o = new P(14);
      o.w = NaN;
      return o;
    },
  ],
  [
    "deleted-and-added-again",
    () => {
      const o: any = new P(15);
      delete o.w;
      o.z = 1;
      o.w = 4;
      return o;
    },
  ],
  ["subclass", () => new Q(16)],
  [
    "subclass-deleted",
    () => {
      const o: any = new Q(17);
      delete o.w;
      delete o.d;
      return o;
    },
  ],
  ["another-prototype", () => Object.setPrototypeOf(new P(18), null)],
  [
    "proxy-above",
    () => {
      const o: any = new P(19);
      delete o.w;
      Object.setPrototypeOf(
        o,
        new Proxy(
          {},
          {
            set(t, k, v, r) {
              console.log("trap", String(k), v);
              return Reflect.defineProperty(r, k, {
                value: v + 100,
                writable: true,
                enumerable: true,
                configurable: true,
              });
            },
          },
        ),
      );
      return o;
    },
  ],
  ["literal-of-the-shape", () => ({ id: 20, w: undefined, h: 1, b: undefined })],
  ["literal-without-it", () => ({ id: 21, h: 1 })],
];
for (let turn = 0; turn < 3; turn++) {
  for (const [label, make] of makers) {
    for (const v of [7, 1.5, -0, NaN, 2 ** 40]) {
      let o = make(),
        r: any;
      try {
        r = put(o, v);
      } catch (e: any) {
        r = e.constructor.name + ": " + e.message;
      }
      if (turn == 2) {
        console.log(label, v, Object.is(r, -0) ? "-0" : String(r));
        show(label, o);
      }
      o = make();
      try {
        r = putB(o, v > 1);
      } catch (e: any) {
        r = e.constructor.name;
      }
      if (turn == 2 && v == 7) console.log(label, "b", String(r), JSON.stringify(o));
      o = make();
      try {
        r = putD(o, v);
      } catch (e: any) {
        r = e.constructor.name;
      }
      if (turn == 2 && v == 1.5) console.log(label, "d", String(r), JSON.stringify(o), Object.keys(o).join());
      o = make();
      try {
        r = putAny(o, turn ? v : "s");
      } catch (e: any) {
        r = e.constructor.name;
      }
      if (turn == 2 && v == 7) console.log(label, "any", String(r), JSON.stringify(o));
    }
  }
}
