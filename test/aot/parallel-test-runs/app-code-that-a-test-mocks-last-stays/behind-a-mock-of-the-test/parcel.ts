let taken = 0;
const run = ((globalThis as any).parcelRuns = ((globalThis as any).parcelRuns ?? 0) + 1);
export const take = () => `parcel of run ${run}, number ${++taken}`;
