const temps = [20.5, 21.5, 99.5, 22.5, 98.5];
function mask(l) { for (let i = 0; i < l.length; i++) if (l[i] > 50) l[i] = null; }
function keep(l) { return [...l].filter(v => v !== null); }
mask(temps);
console.log(keep(temps).length, keep(temps).length);
