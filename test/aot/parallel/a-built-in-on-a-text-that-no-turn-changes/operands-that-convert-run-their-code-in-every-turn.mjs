let asked = 0;
const from = { valueOf() { return ++asked & 1; } };
const q = JSON.parse('"AbCdEf"');
const out = [];
for (let i = 0; i < 4; i++) out.push(q.slice(from), q.substring(from, 4), q.substr(from, 2));
console.log(out.join(), asked);
