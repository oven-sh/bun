// indexOf() and includes() with a text: the list holds texts of other lengths in front of, between and behind those of the same length, in every form a text has.
const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
const wide = "Ā" + letters;
const forms = {
  written: (start, length) => JSON.parse(JSON.stringify(letters.slice(start, start + length))),
  cut: (start, length) => letters.slice(start, start + length),
  joined: (start, length) =>
    letters.slice(start, start + (length >> 1)) + letters.slice(start + (length >> 1), start + length),
  cutOutOfWide: (start, length) => wide.slice(1 + start, 1 + start + length),
  wideItself: (start, length) => JSON.parse(JSON.stringify(wide.slice(start, start + length))),
};
const names = Object.keys(forms);

function inTexts(list, text) {
  return `${list.indexOf(text)} ${list.includes(text)} ${list.indexOf(text, 2)} ${list.includes(text, 5)}`;
}
function inValues(list, text) {
  return `${list.indexOf(text)} ${list.includes(text)} ${list.indexOf(text, 2)} ${list.includes(text, 5)}`;
}
function byLoop(list, text) {
  const from = start => {
    for (let i = start; i < list.length; i++) if (i in list && list[i] === text) return i;
    return -1;
  };
  return `${from(0)} ${from(0) >= 0} ${from(2)} ${from(5) >= 0}`;
}

let compared = 0;
const wrong = [];
for (const made of names) {
  for (const asked of names) {
    for (const length of [0, 1, 3, 7, 8, 9, 16, 17]) {
      for (const at of [0, 1, 4, 7]) {
        const texts = [];
        for (let i = 0; i < 8; i++)
          texts.push(forms[made](i, i === at ? length : i % 3 === 0 ? length : length + 1 + (i & 1)));
        const values = [];
        for (let i = 0; i < 8; i++) values.push(i % 4 === 1 ? i : i % 4 === 2 ? null : texts[i]);
        delete values[3];
        for (const text of [
          forms[asked](at, length),
          forms[asked](at + 1, length),
          forms[asked](at, length + 3),
          texts[at],
        ]) {
          compared += 2;
          if (inTexts(texts, text) !== byLoop(texts, text))
            wrong.push(`texts ${made} ${asked} ${length} ${at}: ${inTexts(texts, text)} for ${byLoop(texts, text)}`);
          if (inValues(values, text) !== byLoop(values, text))
            wrong.push(
              `values ${made} ${asked} ${length} ${at}: ${inValues(values, text)} for ${byLoop(values, text)}`,
            );
        }
      }
    }
  }
}
console.log(compared, wrong.length, wrong.slice(0, 10).join("\n"));
console.log(
  inTexts([], "a"),
  inTexts([1, 2], "a"),
  inTexts([1.5], "a"),
  inTexts(["a"], "a"),
  inTexts(["ab", "a"], "a"),
);
