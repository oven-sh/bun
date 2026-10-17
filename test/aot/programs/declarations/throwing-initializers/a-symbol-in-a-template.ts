function name(of: symbol): { v: string } { return { v: `${of as unknown as string}` }; }
export const made = name(Symbol("s"));
