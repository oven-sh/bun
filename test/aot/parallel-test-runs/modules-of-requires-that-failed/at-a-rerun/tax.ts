const runs = ((globalThis as any).taxRuns = ((globalThis as any).taxRuns ?? 0) + 1);
export const tax = () => "tax of run " + runs;
