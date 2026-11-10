// STATISTIC: CallsInlined >= 29
const base = [5, 3, 8, 1, 7, 2, 6, 4].map(rank => ({ rank })); let s = 0; for (let i = 0; i < 500; i++) s += base.slice().sort((a, b) => a.rank - b.rank)[i & 7].rank; console.log(s);
