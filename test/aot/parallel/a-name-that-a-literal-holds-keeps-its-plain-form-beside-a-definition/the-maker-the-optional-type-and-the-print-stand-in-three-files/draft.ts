export interface Draft { name?: string; size?: number }
export function draft(): Draft { const d: Draft = {}; return d; }
