const f = () => Object.defineProperty({ a: 1, b: 2 }, 'h', { value: 3 }); let s = ''; for (let i = 0; i < 4; i++) { const o = f(); s += o.a + o.h + Object.keys(o).length; } console.log(s);
