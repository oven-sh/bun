function view(of: object): object { return new Proxy(of, {}); }
export const made = view(null as unknown as object);
