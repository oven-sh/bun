const loads = ((globalThis as any).loads = ((globalThis as any).loads ?? 0) + 1);
export const greet = () => "real " + loads;
