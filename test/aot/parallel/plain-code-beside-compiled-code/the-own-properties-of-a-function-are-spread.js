function tagged() {}
tagged.label = "kept";
tagged.count = 2;
const copy = { ...tagged };
const { label, ...rest } = tagged;
console.log(JSON.stringify(copy), label, JSON.stringify(rest), Object.keys(tagged).join(), tagged.name, tagged.length);
