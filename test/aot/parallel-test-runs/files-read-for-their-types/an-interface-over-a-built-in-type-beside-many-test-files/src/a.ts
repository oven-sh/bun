import type { Later } from './types';
export type { Later, Failure } from './types';
export const first = (later?: Later) => (later ? 1 : 0);
