export const make = () => { const out = []; for (let i = 0; i < 3; i++) out.push({ n: i, f: function g() { return [g, i]; } }); return out; };
