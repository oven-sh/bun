// A text is equal to a written text of more than eight characters by its characters, however it was made and however long it is.
function kind(w) {
  if (w === "harbor_opened") return 1;
  if (w === "harbor_closed") return 2;
  if (w === "lantern_is_lit") return 3;
  if (w === "lantern_is_out") return 4;
  if (w === "ferry_departure") return 5;
  if (w === "ferry_arrival_x") return 6;
  if (w === "tide_table_changed") return 7;
  if (w === "tide_table_removed") return 8;
  if (w === "lighthouse_keeper_on") return 9;
  if (w === "lighthouse_keeper_off") return 10;
  if (w === "a_ship_came_in_from_sea") return 11;
  if (w === "a_ship_went_out_to_seas") return 12;
  if (w === "123456789") return 13;
  if (w === "1234567890") return 14;
  if (w === "sixteen_letters_") return 15;
  if (w === "seventeen_letters") return 16;
  if (w === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy") return 17;
  if (w === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy") return 18;
  if (w === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy") return 19;
  if (w === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy") return 20;
  if (w === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy") return 21;
  if (w === "\u00e9t\u00e9_indien_long") return 22;
  if (w === "\u0416\u0416\u0416\u0416\u0416\u0416\u0416\u0416\u0416\u0416") return 23;
  if (w === "\u0416\u0416\u0416\u0416\u0416\u0416\u0416\u0416\u0416\u0417") return 24;
  return 0;
}
function unlike(w) {
  return w !== "tide_table_changed" && "tide_table_removed" !== w;
}
const names = JSON.parse(
  Buffer.from(
    "[\"harbor_opened\", \"harbor_closed\", \"lantern_is_lit\", \"lantern_is_out\", \"ferry_departure\", \"ferry_arrival_x\", \"tide_table_changed\", \"tide_table_removed\", \"lighthouse_keeper_on\", \"lighthouse_keeper_off\", \"a_ship_came_in_from_sea\", \"a_ship_went_out_to_seas\", \"123456789\", \"1234567890\", \"sixteen_letters_\", \"seventeen_letters\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxy\", \"\\u00e9t\\u00e9_indien_long\", \"\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\", \"\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0416\\u0417\"]",
  ).toString(),
);
const flat = text => Buffer.from(text, "utf16le").toString("utf16le");
const narrow = text => Buffer.from(text, "latin1").toString("latin1");
const rope = text => flat(text.slice(0, 5)) + flat(text.slice(5));
const piece = text => flat("__" + text + "__").slice(2, -2);
const keyed = text => {
  const made = rope(text);
  const holder = {};
  holder[made] = 1;
  return made;
};
const changed = (text, at) => flat(text.slice(0, at) + "~" + text.slice(at + 1));
for (const name of names) {
  const row = [kind(name), kind(flat(name)), kind(rope(name)), kind(piece(name)), kind(keyed(name))];
  if (!/[^\x00-\xff]/.test(name)) row.push(kind(narrow(name)));
  for (const at of [0, 7, 8, name.length >> 1, name.length - 9, name.length - 8, name.length - 1]) {
    row.push(kind(changed(name, at)), kind(keyed(changed(name, at))));
  }
  row.push(kind(name + "x"), kind(name.slice(1)), kind(name.slice(0, -1)), unlike(name), unlike(flat(name)));
  console.log(row.join(" "));
}
console.log(kind(5), kind(undefined), kind(null), kind({}), kind(Symbol.iterator), kind(""), kind(1n), kind(names));
