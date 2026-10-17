// An invalid escape in a tagged template makes the cooked string undefined and leaves the raw text.
const t = (s) => s;
const s = t`\xg`;
console.log(s[0], s.raw[0]);
