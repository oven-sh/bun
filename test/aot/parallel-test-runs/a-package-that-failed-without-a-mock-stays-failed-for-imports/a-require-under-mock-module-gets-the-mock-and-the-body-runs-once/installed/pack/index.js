process.env.PACK_RUNS = String(Number(process.env.PACK_RUNS ?? 0) + 1);
if (process.env.PACK_READY !== "yes") throw new Error("pack is not ready");
export const light = "real";
