// An untyped package and a program of it (recipes): one expression for each room, its alternatives told apart by the group that matched
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const reader = lib.read({ list: { gap: /\s+/, note: /#[^\n]*/, dish: /[a-z]\w*/, and: '+', open: { like: '[', over: 'dish' } }, dish: { gap: /\s+/, part: /\w+(?==)/, is: '=', much: { like: /\d+(?:\.\d+)? ?\w*/, turn: much => much.trim().toUpperCase() }, next: '|', close: { like: ']', over: 'list' } } });
for (let i = 0; i < 20; i++) {
  const page = ['soup' + i + ' + stew [ salt=2 g | water=' + i + '.5 l ]', 'bread[flour=500|water=3 cups|]\n# rest\nan hour cake [ eggs=4 ]', 'tea' + i + '[]', '+ jam [ figs=1 | nuts=2 ]'][i % 4], book = {};
  let dishes = [], part;
  try {
    reader.begin(page).each(mark => {
      if (mark.kind === 'dish') dishes.push(mark.what);
      else if (mark.kind === 'part') part = mark.what;
      else if (mark.kind === 'much') for (const dish of dishes) (book[dish] ??= {})[part] = mark.what;
      else if (mark.kind === 'close') dishes = [];
    });
    say(i, JSON.stringify(book), reader.row, reader.place);
  } catch (e) { say(i, e.message); }
}
