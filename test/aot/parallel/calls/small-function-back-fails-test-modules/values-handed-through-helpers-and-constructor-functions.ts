const printValue = console.log;
class Lazy<T> {
  #make: () => T;
  #made: { value: T } | undefined;
  constructor(make: () => T) {
    this.#make = make;
  }
  get value(): T {
    return (this.#made ??= { value: this.#make() }).value;
  }
}
type Same<T> = { [K in keyof T]: T[K] };
let notes = 0;
function note(value: unknown): void {
  if (notes++ < 80) console.log("noted", value);
}
function pass<T>(value: T): T {
  return value;
}
function passThroughClosure<T>(value: T): T {
  let held: T = value;
  const read = (): T => held;
  const write = (next: T): void => {
    held = next;
  };
  write(read());
  return read();
}
function passThroughFlatMap<T>(value: T): T {
  return [value].flatMap((element: T): T[] => [element])[0];
}
function isAlways<T>(value: unknown): value is T {
  return true;
}
function passThroughPredicate<T>(value: unknown): T {
  if (isAlways<T>(value)) return value;
  return value as T;
}
function passThroughReduce<T>(value: T): T {
  return [value].reduce((held: T, element: T): T => element, value);
}
function passThroughSet<T>(value: T): T {
  for (const element of new Set<T>([value])) return element;
  return value;
}
type Held<T> = { kind: "value"; value: T } | { kind: "list"; values: T[] } | { kind: "nothing" };
function takeOut<T>(held: Held<T>, otherwise: T): T {
  switch (held.kind) {
    case "value":
      return held.value;
    case "list":
      return held.values[0];
    default:
      return otherwise;
  }
}
function passThroughSwitch<T>(value: T): T {
  return takeOut<T>({ kind: "list", values: [takeOut<T>({ kind: "value", value }, value)] }, value);
}
function writeAsText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}
const enum Numbers {
  N0 = 0,
}
const enum Texts {
  T_NFD = "NFD",
}
interface O4 {
  maxByteLength: O115;
}
interface O20 {
  [key: string]: any;
}
interface O24 {
  maxByteLength: O115;
}
interface O35 {
  value: Numbers;
}
type O74 = {
  next(...values: any[]): any;
};
type O89 = {
  next(...values: any[]): any;
};
type O90 = {};
interface O103 {
  [key: string]: any;
}
interface O115 {
  c: any;
  [key: string]: any;
}
interface O121All {
  c: number;
}
type O121 = Omit<O121All, "leftOut">;
interface O122All {
  d: (p0: string) => symbol;
  leftOut: string;
}
type O122 = Omit<O122All, "leftOut">;
type O125 = {};
const v4 = { maxByteLength: ArrayBuffer as any } satisfies O4;
printValue("v4", v4);
const v5: string[] = 188 as unknown as string[];
printValue("v5", v5);
try {
  note(v5?.length);
  note(v5?.[0]);
  note((v5?.length ?? -1) + 1);
  if (v5?.length) note(v5.some(() => true));
} catch (error) {
  note((error as any)?.name);
}
let v6!: any;
printValue("v6", v6);
[2] as any;
let v15: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v15", v15);
try {
  // @ts-ignore
  v15 = Symbol.dispose as any;
} catch (e17) {
  console.error((e17 as any)?.name);
}
let v18: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v18", v18);
try {
  // @ts-ignore
  const v20: NonNullable<O20> = passThroughFlatMap<O20>({
    // @ts-ignore
    [v15 as any]() {},
  });
  v18 = v20;
} catch (e21) {
  console.error((e21 as any)?.name);
}
({ maxByteLength: 10 as any }) satisfies O24;
const v31: number | O74 = 7;
printValue("v31", v31);
let v33: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v33", v33);
try {
  // @ts-ignore
  const v35: NonNullable<O35> = passThroughFlatMap<O35>({
    // @ts-ignore
    [Symbol as any]() {},
  });
  v33 = v35;
} catch (e36) {
  console.error((e36 as any)?.name);
}
let v37: any = passThroughReduce<any>(undefined as any);
printValue("v37", v37);
try {
  let { "!": v38 } = v33 as any;
  v37 = v38 as any;
} catch (e39) {
  console.error((e39 as any)?.name);
}
let v40!: any;
printValue("v40", v40);
try {
  v40 = pass<any>(new (ArrayBuffer as any)(v31 as any, Symbol as any) as any);
} catch (e) {
  console.error((e as any)?.name);
}
try {
  new Int8Array(v40);
} catch (e) {
  console.error((e as any)?.name);
}
[2147483649, -2147483649, 2125331880, 1073741823, -65537, -1679765545, 1351691415, -2101942919, -17850];
function F47(this: any, a49: any, ...a50: any[]) {
  if (!new.target) {
    throw "must be called with new";
  }
  (this as any).e = a49 as any;
  (this as any)[42] = -10n as any;
}
function f52(a53: number, a54: any, a55: any): string | boolean {
  function f56(a57: any, a58?: number, a59?: unknown, a60?: any): any {
    return a57;
  }
  f56(a54);
  // @ts-ignore
  Object.defineProperty(v51, "e", { enumerable: true, get: Date });
  return Texts.T_NFD;
}
printValue("f52", f52);
let v63: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v63", v63);
try {
  v63 = (Symbol as any).iterator as any;
} catch (e65) {
  console.error((e65 as any)?.name);
}
let v66: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v66", v66);
try {
  // @ts-ignore
  const v75: O75 = {
    // @ts-ignore
    [v63 as any](): O74 {
      let v68: number | string | boolean = 10;
      // @ts-ignore
      const v74: O74 = {
        // @ts-ignore
        next() {
          (v68 as any)--;
          const v72 = (v68 as any) == (0 as any);
          const v73 = { done: v72, value: v5 };
          return v73;
        },
      };
      return v74;
    },
  };
  v66 = v75;
} catch (e76) {
  console.error((e76 as any)?.name);
}
let v78: any = passThroughReduce<any>(undefined as any);
printValue("v78", v78);
try {
  v78 = (v6 as any).iterator as any;
} catch (e80) {
  console.error((e80 as any)?.name);
}
let v81: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v81", v81);
try {
  // @ts-ignore
  const v90: O90 = {
    // @ts-ignore
    [v78 as any](): O89 {
      let v83: number | string | boolean = 10;
      // @ts-ignore
      const v89: O89 = {
        // @ts-ignore
        next() {
          (v83 as any)--;
          const v87 = (Symbol as any) == (Int8Array as any);
          {
            function* scene87(value: bigint, other: string | null): Generator<number, void, unknown> {
              try {
                let held: bigint = 1n;
                for (let turn = 0; turn < 3; turn++) {
                  if (turn === 2) held = value;
                  note(held.toString());
                }
                note(held + 1n);
                const lazy10 = new Lazy<string | null>(() => other);
                note(lazy10.value);
                yield 1;
              } catch (error) {
                note((error as any)?.name);
              }
            }
            try {
              note([...scene87(v87 as any, undefined as any)]);
            } catch {
              note("threw");
            }
            try {
              note([...scene87(class {} as any, Promise.resolve(1) as any)]);
            } catch {
              note("threw");
            }
            try {
              note([...scene87(10n as any, 10n as any)]);
            } catch {
              note("threw");
            }
            try {
              note([...scene87(Promise.resolve(1) as any, class {} as any)]);
            } catch {
              note("threw");
            }
            try {
              note([...scene87(undefined as any, v87 as any)]);
            } catch {
              note("threw");
            }
          }
          const v88 = { done: v87, value: v83 };
          return v88;
        },
      };
      return v89;
    },
  };
  v81 = v90;
} catch (e91) {
  console.error((e91 as any)?.name);
}
// @ts-ignore
const v92 = /RA]L(x)(x)(x)\4*/gms as any;
printValue("v92", v92);
const v93 = [-1000000000.0, -206.10376468992285, -164056.36108574749, -2.220446049250313e-16, 209.22466252042864];
printValue("v93", v93);
const v94: number[] | undefined = passThroughPredicate<number[] | undefined>([3221225469, 256, 54376, 129] as any);
printValue("v94", v94);
const v95 = [-2147483648, 209581957, -1, 1073741826, 8, -1880097463, -256, 129, 1];
printValue("v95", v95);
let v98: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v98", v98);
try {
  const v99: any = (Symbol as any).asyncDispose as unknown as any;
  v98 = v99;
} catch (e100) {
  console.error((e100 as any)?.name);
}
let v101: undefined | null | object = passThroughReduce<undefined | null | object>(undefined as any);
printValue("v101", v101);
try {
  // @ts-ignore
  const v103: NonNullable<O103> = passThroughFlatMap<O103>({
    // @ts-ignore
    [v98 as any]() {},
  });
  v101 = v103;
} catch (e104) {
  console.error((e104 as any)?.name);
}
function F105(this: any, a107: any, a108: any, a109: any, ...a110: any[]) {
  if (!new.target) {
    throw "must be called with new";
  }
  (this as any).a = a108 as any;
}
printValue("F105", F105);
try {
  new (F105 as any)(
    v94 as any,
    v95 as any,
    WeakSet as any,
    v93 as any,
    v101 as any,
    v94 as any,
    F105 as any,
    v92 as any,
  ) as any;
} catch (e) {
  console.error((e as any)?.name);
}
let v113;
printValue("v113", v113);
try {
  v113 = new Int8Array();
} catch (e) {
  console.error((e as any)?.name);
}
const v115: O115 = { c: v113 as any };
printValue("v115", v115);
const v121 = {
  maxByteLength: 3489,
  // @ts-ignore
  // @ts-ignore
  c: v115,
  // @ts-ignore
  c: v113,
  d: v33,
};
printValue("v121", v121);
passThroughSet<O122>({ d: Symbol as any });
const v123: number[] = [4];
printValue("v123", v123);
const v124 = [268435441, -1, 16, 536870888, -1024, -1171824797, 64, 4294967296];
printValue("v124", v124);
const v125: O125 = {} satisfies O125;
function F133(this: any, a135: any, a136: any) {
  if (!new.target) {
    throw "must be called with new";
  }
  (this as any)["!"] = v125 as any;
  (this as any).f = a135 as any;
  (this as any).b = v123 as any;
}
printValue("F133", F133);
let v137;
printValue("v137", v137);
try {
  v137 = new (F133 as any)(F133 as any);
} catch (e) {
  console.error((e as any)?.name);
}
try {
  passThroughSwitch<number>(new (F133 as any)(v124 as any) as any);
} catch (e) {
  console.error((e as any)?.name);
}
let v139;
printValue("v139", v139);
try {
  v139 = new (F133 as any)(v137 as any, -2133920587 as any);
} catch (e) {
  console.error((e as any)?.name);
}
try {
  (v137 as any).a = v124 as any;
} catch (e) {
  console.error((e as any)?.name);
}
let v140: any = passThroughReduce<any>(undefined as any);
printValue("v140", v140);
try {
  v140 = (v139 as any).constructor as any;
} catch (e142) {
  console.error((e142 as any)?.name);
}
let v143: undefined | null | Function = passThroughReduce<undefined | null | Function>(undefined as any);
printValue("v143", v143);
try {
  class C144 extends (v140 as any) {}
  v143 = C144 as any;
} catch (e145) {
  console.error((e145 as any)?.name);
}
try {
  new (-10n as any)();
} catch (e) {
  console.error((e as any)?.name);
}
let v147: number | bigint | undefined | null = passThroughReduce<number | bigint | undefined | null>(undefined as any);
printValue("v147", v147);
try {
  const v148: number | bigint | O115 = ((v139 as any) & (v125 as any)) as any;
  v147 = v148 as any;
} catch (e149) {
  console.error((e149 as any)?.name);
}
try {
  (v143 as any)[0] ^= -2133920587 as any;
} catch (e) {
  console.error((e as any)?.name);
}
