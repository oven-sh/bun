export const make = () => { const o: Record<string, unknown> = { f: () => 1, a: 1 }; delete o.f; o.f = () => 2; return o; };
