// Methods found through instances: each class here has a valueOf(unit: string) that the program calls with a string and that one native caller calls without an argument. A bit is set for each caller that passed no string.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByMax { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 1; return 0; } }
class ByImul { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 2; return 0; } }
class ByDate { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 4; return 0; } }
class ByNumber { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 8; return 0; } }
class ByFill { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 16; return 0; } }
class ByCharCode { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 32; return 0; } }
class BySlice { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 64; return 0; } }
class ByAt { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 128; return 0; } }
class ByRepeat { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 256; return 0; } }
class ByIsNaN { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 512; return 0; } }
class ByTimes { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 1024; return 0; } }
class ByUnaryPlus { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 2048; return 0; } }
class ByLess { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 4096; return 0; } }
class ByEquals { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 8192; return 0; } }
class ByOr { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 16384; return 0; } }
class ByNegate { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 32768; return 0; } }
class ByAtomics { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 65536; return 0; } }
class ByDataView { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 131072; return 0; } }
class ByToFixed { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 262144; return 0; } }
class BySubstring { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 524288; return 0; } }
class ByArrayBuffer { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 1048576; return 0; } }
class ByAsIntN { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 2097152; return 0; } }
class ByPow { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 4194304; return 0; } }
class ByIncludes { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 8388608; return 0; } }
class BySubarray { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 16777216; return 0; } }
class ByLength { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 33554432; return 0; } }
class ByPadEnd { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 67108864; return 0; } }
class ByStore { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 134217728; return 0; } }
class ByClearTimeout { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 268435456; return 0; } }
class ByIndexOf { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 536870912; return 0; } }
class ByCopyWithin { valueOf(unit: string): number { if (typeof unit !== "string") bits |= 1073741824; return 0; } }

new ByMax().valueOf("m");
attempt(() => Math.max((new ByMax() as any)));
new ByImul().valueOf("m");
attempt(() => Math.imul((new ByImul() as any), 1));
new ByDate().valueOf("m");
attempt(() => new Date((new ByDate() as any)));
new ByNumber().valueOf("m");
attempt(() => Number((new ByNumber() as any)));
new ByFill().valueOf("m");
attempt(() => new Uint8Array(1).fill((new ByFill() as any)));
new ByCharCode().valueOf("m");
attempt(() => "a".charCodeAt((new ByCharCode() as any)));
new BySlice().valueOf("m");
attempt(() => [1].slice((new BySlice() as any)));
new ByAt().valueOf("m");
attempt(() => [1].at((new ByAt() as any)));
new ByRepeat().valueOf("m");
attempt(() => "a".repeat((new ByRepeat() as any)));
new ByIsNaN().valueOf("m");
attempt(() => isNaN((new ByIsNaN() as any)));
new ByTimes().valueOf("m");
attempt(() => (new ByTimes() as any) * 1);
new ByUnaryPlus().valueOf("m");
attempt(() => +(new ByUnaryPlus() as any));
new ByLess().valueOf("m");
attempt(() => (new ByLess() as any) < 1);
new ByEquals().valueOf("m");
attempt(() => (new ByEquals() as any) == 1);
new ByOr().valueOf("m");
attempt(() => (new ByOr() as any) | 0);
new ByNegate().valueOf("m");
attempt(() => -(new ByNegate() as any));
new ByAtomics().valueOf("m");
attempt(() => Atomics.load(new Int32Array(1), (new ByAtomics() as any)));
new ByDataView().valueOf("m");
attempt(() => new DataView(new ArrayBuffer(8)).getInt8((new ByDataView() as any)));
new ByToFixed().valueOf("m");
attempt(() => (1).toFixed((new ByToFixed() as any)));
new BySubstring().valueOf("m");
attempt(() => "abc".substring((new BySubstring() as any)));
new ByArrayBuffer().valueOf("m");
attempt(() => new ArrayBuffer((new ByArrayBuffer() as any)));
new ByAsIntN().valueOf("m");
attempt(() => BigInt.asIntN((new ByAsIntN() as any), 1n));
new ByPow().valueOf("m");
attempt(() => Math.pow((new ByPow() as any), 1));
new ByIncludes().valueOf("m");
attempt(() => [3].includes(3, (new ByIncludes() as any)));
new BySubarray().valueOf("m");
attempt(() => new Uint8Array(2).subarray((new BySubarray() as any)));
new ByLength().valueOf("m");
attempt(() => Array.from({ length: (new ByLength() as any) }));
new ByPadEnd().valueOf("m");
attempt(() => "a".padEnd((new ByPadEnd() as any)));
new ByStore().valueOf("m");
attempt(() => (new Float64Array(1)[0] = (new ByStore() as any)));
new ByClearTimeout().valueOf("m");
attempt(() => clearTimeout((new ByClearTimeout() as any)));
new ByIndexOf().valueOf("m");
attempt(() => "abc".indexOf("c", (new ByIndexOf() as any)));
new ByCopyWithin().valueOf("m");
attempt(() => [1, 2].copyWithin((new ByCopyWithin() as any), 1));
console.log(bits.toString(2));
