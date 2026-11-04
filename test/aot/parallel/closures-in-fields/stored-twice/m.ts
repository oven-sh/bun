export const make = (k: boolean) => { const o = { n: 1, f: () => "first" }; if (k) o.f = () => "second"; return o; };
