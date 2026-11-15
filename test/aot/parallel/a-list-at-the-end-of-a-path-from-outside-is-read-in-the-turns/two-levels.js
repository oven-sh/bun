// STATISTIC: UnrolledLoopsEmitted >= 1
// STATISTIC: SiteCachedReadsEmitted >= 1
function g(data, t) { let s = t & 1; for (let i = 0; i < data.page.rows.length; i++) s = s + data.page.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const data = JSON.parse('{"page":{"rows":[3,1,4,1,5,9,2,6,5,3,5]}}');
for (let r = 0; r < rounds; r++) console.log(g(data, r));
