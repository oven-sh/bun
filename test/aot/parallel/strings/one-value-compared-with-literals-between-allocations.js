// CALLS- answersJoined StringsAreEqual
// CALLS- answersInArrays StringsAreEqual
// CALLS- bitsBetweenTexts StringsAreEqual
function answersJoined(holder, key) {
  const value = holder[key];
  return (value === "get") + ":" + (value === "put") + ":" + (value === "post") + ":" + (value === "g") + ":" + (value === undefined);
}

function answersInArrays(holder, key) {
  const value = holder[key];
  const first = [value === "lit_aa"];
  const second = [first, value === "lit_ab"];
  const third = { second, is: value === "lit_ac" };
  return [third, value === "lit_aa", value === "li"];
}

function bitsBetweenTexts(value, n) {
  let found = 0;
  let text = "";
  if (value === "get") found |= 1;
  text += n;
  if (value === "put") found |= 2;
  text += found;
  if (value === "post") found |= 4;
  text += n + 0.5;
  if (value === "get") found |= 8;
  if (value === "p") found |= 16;
  return text + ":" + found;
}

const none = process.argv.length > 99 ? "no" : "";
const words = ["get", "put", "post", "g", "p", "", "lit_aa", "lit_ab", "lit_ac", "lit_ad", "li", "gets", "GET"];
const kinds = {
  flat: word => JSON.parse(JSON.stringify(none + word)),
  rope: word => word.slice(0, 1) + none + word.slice(1),
  slice: word => ("<<" + JSON.parse(JSON.stringify(none + word)) + ">>").slice(2, 2 + word.length),
  wide: word => JSON.parse(JSON.stringify("Δ" + word)).slice(1),
  wideRope: word => ("Δ" + word.slice(0, 1)).slice(1) + word.slice(1),
  wideOther: word => word.replace("t", "т"),
};

function mix(sum, text) {
  for (let i = 0; i < text.length; ++i) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return sum;
}

for (const [kind, make] of Object.entries(kinds)) {
  let word = "";
  const holder = {
    get made() {
      return make(word);
    },
  };
  const sums = [];
  for (word of words) {
    let sum = 0;
    for (let i = 0; i < 400; ++i) {
      sum = mix(sum, answersJoined(holder, "made"));
      sum = mix(sum, JSON.stringify(answersInArrays(holder, "made")));
      sum = mix(sum, bitsBetweenTexts(make(word), i));
    }
    sums.push(sum);
  }
  console.log(kind, sums.join(" "));
}

const others = [undefined, null, 0, 1.5, true, 10n, Symbol.iterator, {}, ["get"], new String("get"), { toString: () => "get" }];
console.log(others.map((value, i) => answersJoined(others, i) + " " + JSON.stringify(answersInArrays(others, i)) + " " + bitsBetweenTexts(value, i)).join("\n"));
globalThis.kept = [answersJoined, answersInArrays, bitsBetweenTexts];
