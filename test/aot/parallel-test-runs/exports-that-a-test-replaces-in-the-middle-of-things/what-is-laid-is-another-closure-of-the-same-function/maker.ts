export function makeCounter(start: number): (by: number) => number { let total = start; return (by: number): number => { total += by; return total; }; }
export function makeNamer(name: string): () => string { return (): string => name; }
