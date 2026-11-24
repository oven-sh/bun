const C = new Map([["alpha", 1], ["beta", 2], ["gamma", 3], ["delta", 4], ["epsilon", 5], ["zeta", 6], ["eta", 7], ["theta", 8], ["iota", 9], ["kappa", 10], ["lambda", 11], ["mu", 12], ["nu", 13], ["xi", 14], ["omicron", 15], ["pi", 16], ["rho", 17], ["sigma", 18], ["tau", 19], ["upsilon", 20], ["phi", 21], ["chi", 22], ["psi", 23], ["omega", 24]]);
const S = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega"]);
const words = JSON.parse('["alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa","lambda","mu","nu","xi","omicron","pi","rho","sigma","tau","upsilon","phi","chi","psi","omega"]');
const asked = [];
for (const word of words) {
  asked.push(word);
  for (let i = 0; i < 1500; i++) {
    asked.push(word + i.toString(36));
    asked.push(word.slice(0, -1) + String.fromCharCode(97 + i % 26) + (i < 26 ? "" : i.toString(36)));
    asked.push(i.toString(36) + word);
    asked.push(word.slice(0, 1 + i % word.length));
  }
}
const texts = JSON.parse(JSON.stringify(asked));
let found = 0, present = 0, sum = 0;
for (let round = 0; round < 2; round++) {
  for (const text of texts) {
    const value = C.get(text);
    if (value !== undefined) { found++; sum = (sum * 31 + value + text.length) % 1000003; }
    if (C.has(text)) present++;
    if (S.has(text)) present += 2;
  }
}
console.log(texts.length, found, present, sum);
