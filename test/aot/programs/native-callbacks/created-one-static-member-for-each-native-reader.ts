// Held from creation: each class here has a static method whose parameter says number, as the program's call does, and one native caller that finds the method on the class itself and passes something else or nothing. A bit is set for each such caller.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByAll extends Promise<number> { static resolve: any = (value: number): unknown => { if (typeof value !== "number") bits |= 1; return Promise.resolve(0); }; }
class ByRace extends Promise<number> { static resolve: any = (value: number): unknown => { if (typeof value !== "number") bits |= 2; return Promise.resolve(0); }; }
class ByAny extends Promise<number> { static resolve: any = (value: number): unknown => { if (typeof value !== "number") bits |= 4; return Promise.resolve(0); }; }
class ByAllSettled extends Promise<number> { static resolve: any = (value: number): unknown => { if (typeof value !== "number") bits |= 8; return Promise.resolve(0); }; }
class ByInstanceOf { static [Symbol.hasInstance](value: number): any { if (typeof value !== "number") bits |= 16; return 0; } }
class ByString { static toString(value: number): any { if (typeof value !== "number") bits |= 32; return 0; } }
class ByTemplate { static toString(value: number): any { if (typeof value !== "number") bits |= 64; return 0; } }
class ByNumber { static valueOf(value: number): any { if (typeof value !== "number") bits |= 128; return 0; } }
class ByPrimitive { static [Symbol.toPrimitive](value: number): any { if (typeof value !== "number") bits |= 256; return 0; } }
class ByStringify { static toJSON(value: number): any { if (typeof value !== "number") bits |= 512; return 0; } }
class ByInspect { static [Symbol.for("nodejs.util.inspect.custom")](value: number): any { if (typeof value !== "number") bits |= 1024; return 0; } }
class ByResolve { static then(value: number): any { if (typeof value !== "number") bits |= 2048; return 0; } }
class BySpread { static [Symbol.iterator](value: number): any { if (typeof value !== "number") bits |= 4096; return 0; } }
class ByReplace { static [Symbol.replace](value: number): any { if (typeof value !== "number") bits |= 8192; return 0; } }
class ByValues { static run(value: number): any { if (typeof value !== "number") bits |= 16384; return 0; } }
class ByInstance { static run(value: number): any { if (typeof value !== "number") bits |= 32768; return 0; } }

(ByAll as any).resolve(1);
attempt(() => (Promise.all as any).call(ByAll, ["s"]));
(ByRace as any).resolve(1);
attempt(() => (Promise.race as any).call(ByRace, ["s"]));
(ByAny as any).resolve(1);
attempt(() => (Promise.any as any).call(ByAny, ["s"]));
(ByAllSettled as any).resolve(1);
attempt(() => (Promise.allSettled as any).call(ByAllSettled, ["s"]));
(ByInstanceOf as any)[Symbol.hasInstance](1);
attempt(() => ("s" as any) instanceof ByInstanceOf);
(ByString as any).toString(1);
attempt(() => String(ByString));
(ByTemplate as any).toString(1);
attempt(() => `(new ByTemplate() as any){ByTemplate}`);
(ByNumber as any).valueOf(1);
attempt(() => Number(ByNumber));
(ByPrimitive as any)[Symbol.toPrimitive](1);
attempt(() => +(ByPrimitive as any));
(ByStringify as any).toJSON(1);
attempt(() => JSON.stringify({ k: ByStringify }));
(ByInspect as any)[Symbol.for("nodejs.util.inspect.custom")](1);
attempt(() => Bun.inspect(ByInspect));
(ByResolve as any).then(1);
attempt(() => Promise.resolve(ByResolve));
(BySpread as any)[Symbol.iterator](1);
attempt(() => [...(BySpread as any)]);
(ByReplace as any)[Symbol.replace](1);
attempt(() => "a".replace(ByReplace as any, "b"));
(ByValues as any).run(1);
attempt(() => (Object.getOwnPropertyDescriptor(ByValues, "run")!.value as any)("s"));
(ByInstance as any).run(1);
attempt(() => (Reflect.get(new ByInstance(), "constructor") as any).run("s"));
setTimeout(() => console.log(bits.toString(2)), 5);
