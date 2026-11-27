import { take } from './parcel.ts';

const run = ((globalThis as any).deskRuns = ((globalThis as any).deskRuns ?? 0) + 1);
export const read = () => `desk of run ${run}: ${take()}`;
