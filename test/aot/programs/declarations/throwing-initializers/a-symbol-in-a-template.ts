function name(of: symbol): { v: string } { return { v: `${of as any}` }; }
export const made = name(Symbol("s"));
