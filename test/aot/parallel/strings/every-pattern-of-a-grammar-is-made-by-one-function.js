// One function makes every pattern of a grammar, and nothing enters it but calls that name it. The build has seen each of them, so it knows every text that the one `new RegExp` makes: they
// are no guesses, and all of them have their code in the image, however much code that is.
// KNOWN first ^r01: (?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu)$
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpMatchesInterpreted = 0

const WORD = "(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu)";
const PAIR = `${WORD}[-+]${WORD}`;
const LINE = `${PAIR} ${PAIR} ${PAIR} ${PAIR}`;
const rules = [];
function rule(body) {
  rules.push(new RegExp(`^${body}$`));
}
rule(`r01: ${WORD}`);
rule(`r02: ${LINE}`);
rule(`r03: ${LINE}, ${LINE}`);
rule(`r04: ${LINE}; ${LINE}`);
rule(`r05: ${LINE}: ${LINE}`);
rule(`r06: ${LINE}! ${LINE}`);
rule(`r07: ${LINE}= ${LINE}`);
rule(`r08: ${LINE}/ ${LINE}`);
rule(`r09: ${LINE}# ${LINE}`);
rule(`r10: ${LINE}% ${LINE}`);
rule(`r11: ${LINE}& ${LINE}`);
rule(`r12: ${LINE}~ ${LINE}`);
rule(`r13: ${LINE}@ ${LINE}`);
rule(`r14: ${LINE}< ${LINE}`);
rule(`r15: ${LINE}> ${LINE}`);
rule(`r16: ${LINE}_ ${LINE}`);

const line = "alpha-beta gamma+delta mu-mu iota+eta";
const marks = ",;:!=/#%&~@<>_";
let matched = 0;
for (let index = 0; index < rules.length; index++) {
  const name = "r" + String(index + 1).padStart(2, "0");
  const subject = index === 0 ? "kappa" : index === 1 ? line : line + marks[index - 2] + " " + line;
  if (rules[index].test(name + ": " + subject)) matched++;
  if (rules[index].test(name + ": " + subject + "?")) matched += 100;
}
console.log(rules.length, matched);
