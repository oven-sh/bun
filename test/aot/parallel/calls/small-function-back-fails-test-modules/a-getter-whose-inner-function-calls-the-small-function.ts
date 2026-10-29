import type { int32 } from "bun";
const printValue = console.log;
let notes = 0;
function note(value: unknown): void {
  if (notes++ < 80) console.log("noted", value);
}
function isNever<T>(value: unknown): value is T {
  return false;
}
function passThroughFalsePredicate<T>(value: T | string): T {
  if (isNever<string>(value)) return value.length as unknown as T;
  return value as T;
}
interface O35 {}
interface O66Shape {}
type O66 = { [K in keyof O66Shape]: O66Shape[K] };
interface O83Base<T0 = number, T1 = number, T2 = int32> {}
interface O95Base<T0 = string> {}
try {
  class C27 extends (Float32Array as any) {
    static #m(a29: any, a30: any, a31: any) {}
    constructor(a40 = 848 as any, a41: any, a42: any, a43: any) {
      super();
    }
  }
} catch (e44) {
  console.error((e44 as any)?.name);
}
class C48 {
  async toString(a50: number, a51: number, a52 = C48, a53: any): Promise<C48> {
    try {
    } catch (error) {}
    return this;
  }
}
printValue("C48", C48);
let v59: undefined | null | object = undefined;
try {
  const v83 = {
    // @ts-ignore
    get [v47 as any](): number {
      function f61(a62: any, ...a63: (any[] | O35)[]) {
        const v66: O66 = { maxByteLength: 1073741823 };
        const v68: C48 = passThroughFalsePredicate<C48>(new SharedArrayBuffer(7, v66) as any);
        try {
          tested0: {
            note(v68);
          }
        } catch (error) {}
        new Int32Array(v68 as any);
        try {
          // @ts-ignore
          v68.grow(v73) satisfies any;
        } catch (e) {
          console.error((e as any)?.name);
        }
      }
      const v76 = new (Promise as any)(f61 as any);
      {
        function scene76(value: O95Base): void {
          try {
          } catch (error) {}
        }
      }
      async function* f77<T100 extends number | undefined>(
        a78: T100,
        a79: number,
      ): AsyncGenerator<number, number, any> {
        return a79;
      }
    },
  };
  v59 = v83 as any;
} catch (e84) {
  console.error((e84 as any)?.name);
}
let v86;
try {
  v86 = new (ArrayBuffer as any)(6 as any, v59 as any);
} catch (e) {
  console.error((e as any)?.name);
}
