// `value` is also an accessor of WebAssembly.Global, `day` of Temporal.PlainDate and `region` of Intl.Locale. This program never reads WebAssembly, Temporal or Intl, so it has no such object:
// each name points to the one class of the program that has the field, and the loops read and write slots.
// COUNT: arrivals <= 100
let sink;
class Item {
  constructor(value) {
    this.flag = true;
    this.value = value;
  }
}
class Birthday {
  constructor(day) {
    this.guests = 2;
    this.day = day;
  }
}
class Market {
  constructor(region) {
    this.stalls = 4;
    this.region = region;
  }
}
function sum(item, birthday, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += item.value + birthday.day;
  return total;
}
function store(market, item, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    market.region = i & 7;
    total += item.value;
  }
  return total + market.region;
}
const hidden = process.env.NAMES_OF_THIS_TEST ?? "";
const functions = { sum, store };
const operands = { item: new Item(3), birthday: new Birthday(5), market: new Market(1) };
sink = [functions, operands];
console.log(sink[0]["sum" + hidden](sink[1]["item" + hidden], sink[1]["birthday" + hidden], 20000));
console.log(sink[0]["store" + hidden](sink[1]["market" + hidden], sink[1]["item" + hidden], 20000), typeof sink);
