const printValue = console.log;
class Box<T> {}
function passThroughForEach<T>(value: T): T {
  let held: T = value;
  return held;
  try {
  } catch {}
}
const enum Numbers {
  N0 = 0 * 1,
}
type O78 = {
  a?: number;
  c: number;
};
let v27: boolean = undefined as any;
printValue("v27", v27);
try {
  // @ts-ignore
  const v29: number[] = {
    // @ts-ignore
  } as unknown as number[];
  v27 = v29 as any;
} catch (e30) {
  console.error(String((e30 as any)?.message));
}
let v32: C132 = undefined as any;
printValue("v32", v32);
try {
  function F33(a35: any) {}
  v32 = F33 as any;
} catch (e36) {
  console.error(String((e36 as any)?.message));
}
let v37;
let v43: boolean = undefined as any;
printValue("v43", v43);
try {
  // @ts-ignore
  const v52: number[] = {
    // @ts-ignore
    [v40 as any](): C163 {
      let v45: bigint = 10 as unknown as bigint;
    },
  } as unknown as number[];
  v43 = v52 as any;
} catch (e53) {
  console.error(String((e53 as any)?.message));
}
let v69: C132 = undefined as any;
printValue("v69", v69);
try {
  function F70() {
    if (!new.target) {
      throw "must be called with new";
    }
    const v73: O78 = {} as any;
    const v75: string = new (Proxy as any)(ArrayBuffer as any, v73 as any) as unknown as string;
    (v75 as any).__proto__ = v37 as any;
  }
  v69 = F70 as any;
} catch (e76) {
  console.error(String((e76 as any)?.message));
}
try {
  new (v69 as any)() as any;
} catch (e) {
  console.error(String((e as any)?.message));
}
const v94 = {
  // @ts-ignore
};
printValue("v94", v94);
const v95: C132 = { d: v94 } as unknown as C132;
printValue("v95", v95);
const v97 = class {
  static e: any;
  // @ts-ignore
  constructor(a99: int32, a100: int32, a101: number, ...a102: bigint[]) {}
};
let v104: C132 = undefined as any;
let v111;
printValue("v111", v111);
let v117: boolean = undefined as any;
printValue("v117", v117);
try {
} catch (e123) {
  console.error(String((e123 as any)?.message));
}
let v125: C132 = undefined as any;
class C132 {
  b: bigint = v125 as any;
}
const v138 = {
  // @ts-ignore
  async *o(a135 = v120 as any, a136 = v57 as any): AsyncGenerator<number, void, any> {
    super[this as any];
  },
};
let v151!: number;
printValue("v151", v151);
let v162;
printValue("v162", v162);
class C163 {
  // @ts-ignore
  16 = Uint8ClampedArray;
}
let v171!: number[];
printValue("v171", v171);
try {
  v171 = passThroughForEach<number[]>(new BigInt64Array(v151) as any);
} catch (e) {
  console.error(String((e as any)?.message));
}
const v173 = class {
  // @ts-ignore
  #n() {
    return v69;
  }
};
let v205: C132 = undefined as any;
printValue("v205", v205);
try {
  function F206(a208 = WeakSet as any, a209: any) {}
  v205 = F206 as any;
} catch (e210) {
  console.error(String((e210 as any)?.message));
}
let v211;
printValue("v211", v211);
// @ts-ignore
