// Sloppy code computes NaNs out of undefined and out of the bytes of a float view in the expressions that use them as positions in arrays, strings and views, that push them and that switch on them.
const hex = value =>
  Array.from(new Uint8Array(new Float64Array([value]).buffer), byte => byte.toString(16).padStart(2, "0")).join("");

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 0xf8, 0xff, 7, 0, 0, 0, 0, 0, 0xf0, 0x7f, 0, 0, 0, 0, 0, 0, 0, 0x40]);
const view = new Float64Array(bytes.buffer);
const sparse = [1.5, undefined, 0.5];

function positions(at) {
  const list = [10, 20, 30],
    fractions = [0.5, 1.5, 2.5],
    words = ["a", "b", "c"],
    floats = new Float64Array([1, 2, 3]),
    text = "abc";
  console.log(
    "read",
    list[sparse[at] * 2],
    list[view[at] + 1],
    fractions[sparse[at] * 2],
    fractions[view[at]],
    words[sparse[at] * 2],
    words[view[at] - 1],
    floats[sparse[at] * 2],
    floats[view[at]],
    sparse[at] * 2 in list,
    view[at] + 1 in words,
    text[sparse[at] * 2],
    text.charCodeAt(view[at]),
    text.slice(sparse[at] * 2, view[at]),
  );
  list[sparse[at] * 2] = 7;
  fractions[view[at] + 1] = 7.5;
  words[sparse[at] * 2] = "d";
  words[view[at]] = "e";
  floats[sparse[at] * 2] = 7;
  floats[view[at]] = 8;
  fractions[sparse[at] * 2] = sparse[at] * 2;
  console.log(
    "stored",
    Object.entries(list).join(" "),
    Object.entries(fractions).join(" "),
    Object.entries(words).join(" "),
    floats.join(),
  );
}

function pushes(at) {
  const doubles = [0.5],
    integers = [1],
    anything = ["x"],
    empty = [];
  doubles.push(sparse[at] * 2);
  doubles.push(view[at]);
  doubles.push(view[at] + 1, 2.5, sparse[at] - 1);
  integers.push(sparse[at] * 2);
  integers.push(view[at] + 1);
  anything.push(sparse[at] * 2);
  anything.push(view[at]);
  empty.push(view[at] * 2);
  empty.push(-(sparse[at] * 2));
  console.log(
    "pushed",
    doubles.map(hex).join(),
    integers.map(hex).join(),
    anything.slice(1).map(hex).join(),
    empty.map(hex).join(),
  );
}

function choose(at) {
  let chosen = "";
  switch (sparse[at] * 2) {
    case 1:
      chosen += "one";
      break;
    case 3:
      chosen += "three";
      break;
    default:
      chosen += "neither";
  }
  switch (view[at] + 1) {
    case 3:
      chosen += " three";
      break;
    case 4:
      chosen += " four";
      break;
    default:
      chosen += " neither";
  }
  return chosen;
}

for (let at = 0; at < 3; at++) {
  positions(at);
  pushes(at);
  console.log(choose(at));
}
