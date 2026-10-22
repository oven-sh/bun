// Methods found through instances: each class here has a Symbol.toPrimitive method whose parameter says number, as the program's call does, and one native caller that passes a hint, a string. A bit is set for each such caller.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByAbs { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 1; return 0; } }
class ByString { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 2; return 0; } }
class ByPlus { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 4; return 0; } }
class ByTemplate { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 8; return 0; } }
class ByDate { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 16; return 0; } }
class ByEquals { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 32; return 0; } }
class ByLess { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 64; return 0; } }
class ByIndexOf { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 128; return 0; } }
class ByKey { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 256; return 0; } }
class ByNumber { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 512; return 0; } }
class ByBigInt { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 1024; return 0; } }
class ByJoin { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 2048; return 0; } }
class ByHas { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 4096; return 0; } }
class ByDefine { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 8192; return 0; } }
class ByIn { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 16384; return 0; } }
class ByDateJSON { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 32768; return 0; } }
class ByBuffer { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 65536; return 0; } }
class BySetTime { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 131072; return 0; } }
class ByNumberFormat { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 262144; return 0; } }
class ByStringRaw { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 524288; return 0; } }
class ByFromCharCode { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 1048576; return 0; } }
class ByBigIntStore { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 2097152; return 0; } }
class ByIsFinite { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 4194304; return 0; } }
class ByParseFloat { [Symbol.toPrimitive](digits: number): number { if (typeof digits !== "number") bits |= 8388608; return 0; } }

new ByAbs()[Symbol.toPrimitive](2);
attempt(() => Math.abs((new ByAbs() as any)));
new ByString()[Symbol.toPrimitive](2);
attempt(() => String((new ByString() as any)));
new ByPlus()[Symbol.toPrimitive](2);
attempt(() => (new ByPlus() as any) + 1);
new ByTemplate()[Symbol.toPrimitive](2);
attempt(() => `(new ByTemplate() as any){(new ByTemplate() as any)}`);
new ByDate()[Symbol.toPrimitive](2);
attempt(() => new Date((new ByDate() as any)));
new ByEquals()[Symbol.toPrimitive](2);
attempt(() => (new ByEquals() as any) == 5);
new ByLess()[Symbol.toPrimitive](2);
attempt(() => (new ByLess() as any) < 6);
new ByIndexOf()[Symbol.toPrimitive](2);
attempt(() => [1].indexOf(1, (new ByIndexOf() as any)));
new ByKey()[Symbol.toPrimitive](2);
attempt(() => ({} as any)[(new ByKey() as any)]);
new ByNumber()[Symbol.toPrimitive](2);
attempt(() => Number((new ByNumber() as any)));
new ByBigInt()[Symbol.toPrimitive](2);
attempt(() => BigInt((new ByBigInt() as any)));
new ByJoin()[Symbol.toPrimitive](2);
attempt(() => [(new ByJoin() as any)].join());
new ByHas()[Symbol.toPrimitive](2);
attempt(() => Reflect.has({}, (new ByHas() as any)));
new ByDefine()[Symbol.toPrimitive](2);
attempt(() => Object.defineProperty({}, (new ByDefine() as any), {}));
new ByIn()[Symbol.toPrimitive](2);
attempt(() => (new ByIn() as any) in {});
new ByDateJSON()[Symbol.toPrimitive](2);
attempt(() => Date.prototype.toJSON.call((new ByDateJSON() as any)));
new ByBuffer()[Symbol.toPrimitive](2);
attempt(() => Buffer.from((new ByBuffer() as any)));
new BySetTime()[Symbol.toPrimitive](2);
attempt(() => new Date(0).setTime((new BySetTime() as any)));
new ByNumberFormat()[Symbol.toPrimitive](2);
attempt(() => new Intl.NumberFormat("en").format((new ByNumberFormat() as any)));
new ByStringRaw()[Symbol.toPrimitive](2);
attempt(() => String.raw({ raw: [(new ByStringRaw() as any)] } as any));
new ByFromCharCode()[Symbol.toPrimitive](2);
attempt(() => String.fromCharCode((new ByFromCharCode() as any)));
new ByBigIntStore()[Symbol.toPrimitive](2);
attempt(() => (new BigInt64Array(1)[0] = (new ByBigIntStore() as any)));
new ByIsFinite()[Symbol.toPrimitive](2);
attempt(() => isFinite((new ByIsFinite() as any)));
new ByParseFloat()[Symbol.toPrimitive](2);
attempt(() => parseFloat((new ByParseFloat() as any)));
console.log(bits.toString(2));
