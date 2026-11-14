// An untyped package and a program of it (texts): amounts with units read by one table after the other: durations, sizes, angles, money, coordinates, times of day
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
['1', '53 yrs', '.5ms', '-100ms', '1.5h', '2 days', '1 Week', '10 minutes', '5M', '1kb', '-1.5 GB', '+12 mb', '10TB', '90deg', '1.5turn', '3.14159rad', "12° 30' 15\"", "-0.5°", '$1,234.56', '€5', '£ 1,000,000', '12.50 USD', '7 GBP', '12:30', '1:02:03.5', '12:00 am', '12:15pm', '13:00 p', '7:05 PM', 'nothing', '', '1,2', '$1,23', '10 b', '1 mb extra'].forEach(function (t, i) { for (var k = 0; k < 3; k++) { var s = k === 1 ? t.replace(/\d/g, function (d) { return (+d + i) % 10; }) : k === 2 ? (t + '|' + i).split('|')[0] : t, o = lib.parse(s); say(i, k, JSON.stringify(s), JSON.stringify(o), lib.print(o), lib.print(o, true)); } });
