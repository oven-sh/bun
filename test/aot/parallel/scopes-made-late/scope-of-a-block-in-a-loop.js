function collect(count) { const made = []; for (let i = 0; i < count; i++) { if (i === 1) continue; let seen = i; made.push(() => seen++); } return made.map(f => f() + f()).join(); }
console.log(collect(4));
