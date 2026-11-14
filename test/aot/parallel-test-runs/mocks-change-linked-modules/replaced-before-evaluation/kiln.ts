if (!(globalThis as any).ready) throw new RangeError("kiln cold");
export const heat = () => "real";
