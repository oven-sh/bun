const word = process.argv[2] ?? 'none';
let said = '';
for (let i = 0; i < 12; i++) {
  let made = 'm' + i;
  try { const path = process.env.PATH; made += typeof path; if (i === 7) throw new Error('at' + i); } catch (error) { said += error.message + made + ';'; }
}
console.log(said, word);
