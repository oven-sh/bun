// An untyped package and a program of it (schedules): schedules of minutes, hours, days, months and weekdays; the next times, names, steps, lists and a wheel of timers on a made clock
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var from = Date.UTC(2026, 10, 12, 9, 58); ['* * * * *', '*/15 9-17 * * mon-fri', '0 0 29 2 *', '5,10-12/2 */6 1,15 jan,JUL *', '@weekly', '30 4 13 * 5', '0 0 31 4 *', '59 23 31 12 7', '0 12 * * sun', '*/7 * 28-31 * *', '60 * * * *', '* * *', 'a * * * *', '5-1 * * * *', '*/0 * * * *', '1/20 0 * * *', '@daily'].forEach(function (c, i) { for (var k = 0; k < 2; k++) try { say(i, k, c, new lib.Cron(c).list(from + k * 864e5 * 45, 4).join(' ')); } catch (e) { say(i, k, e.message); } });
