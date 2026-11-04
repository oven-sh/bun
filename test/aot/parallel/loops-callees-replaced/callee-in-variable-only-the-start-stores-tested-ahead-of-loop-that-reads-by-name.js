// A loop calls what a variable of the module holds and reads names off objects nobody knows. Only the start of the program stores to the first variable. The others are stored to from inside a turn.
// COUNT: branches <= 3600
const text = '{"id":7,"name":"row"}';

let parse = JSON.parse;
if (text.length > 1000) parse = String;
function storedOnlyAtStart(turns) {
  let sum = 0;
  for (let t = 0; t < turns; t++) {
    const row = parse(text);
    sum = (sum + row.name.length) | 0;
  }
  return sum;
}

let byGetter = JSON.parse;
if (text.length > 1000) byGetter = String;
const storesWhenRead = {
  get name() {
    byGetter = String;
    return "getter";
  },
};
function storedByGetter(rows) {
  let out = "";
  for (let t = 0; t < rows.length; t++) out += typeof byGetter(text) + rows[t].name.length + " ";
  return out;
}

let byConversion = JSON.parse;
if (text.length > 1000) byConversion = String;
const storesWhenAdded = {
  valueOf() {
    byConversion = String;
    return 5;
  },
};
function storedByConversion(values) {
  let out = "";
  for (let t = 0; t < values.length; t++) out += typeof byConversion(text) + (values[t] + 1) + " ";
  return out;
}

let byCallback = JSON.parse;
if (text.length > 1000) byCallback = String;
function storedByCallback(lists) {
  let out = "";
  for (let t = 0; t < lists.length; t++) {
    out += typeof byCallback(text) + " ";
    lists[t].forEach(item => {
      if (item.name === "now") byCallback = String;
    });
  }
  return out;
}

let acrossAwaits = JSON.parse;
if (text.length > 1000) acrossAwaits = String;
async function storedWhileWaiting(rows) {
  let out = "";
  for (let t = 0; t < rows.length; t++) {
    out += typeof acrossAwaits(text) + rows[t].name.length + " ";
    await null;
  }
  return out;
}

let behindTheCall = JSON.parse;
if (text.length > 1000) behindTheCall = String;
function storedBehindTheCall(rows) {
  let out = "";
  for (let t = 0; t < rows.length; t++) out += typeof behindTheCall(text) + rows[t].name.length + " ";
  return out;
}

const plain = JSON.parse('[{"name":"a"},{"name":"bc"},{"name":"def"}]');
console.log(storedOnlyAtStart(1000));
console.log(storedByGetter([plain[0], storesWhenRead, plain[1], plain[2]]));
console.log(storedByConversion([1, storesWhenAdded, 2, 3]));
console.log(storedByCallback([[plain[0]], [{ name: "now" }], [plain[1]], []]));
const waiting = storedWhileWaiting(plain);
acrossAwaits = String;
console.log(storedBehindTheCall(plain));
behindTheCall = String;
console.log(storedBehindTheCall(plain));
waiting.then(console.log);
