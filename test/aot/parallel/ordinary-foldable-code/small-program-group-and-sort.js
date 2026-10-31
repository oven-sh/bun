const PEOPLE = [
  { name: "Ann", team: "red", age: 31 },
  { name: "Bob", team: "blue", age: 25 },
  { name: "Cid", team: "red", age: 42 },
  { name: "Dee", team: "blue", age: 37 },
];
const byTeam = {};
for (const p of PEOPLE) (byTeam[p.team] ??= []).push(p.name);
const oldest = [...PEOPLE].sort((a, b) => b.age - a.age)[0];
console.log(byTeam, oldest.name, PEOPLE.map((p) => p.age).sort((a, b) => a - b));
