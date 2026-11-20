// formats and parses dates by the letters of a mask; everything in UTC
'use strict';
var DAY = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
var MONTH = 'January February March April May June July August September October November December'.split(' ');
var SPAN = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };
var STEP = { second: 1, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000 };
function wide(number, size) { var digits = '' + number; return digits.length >= size ? digits : '0000'.slice(0, size - digits.length) + digits; }
function place(day) { if (day === 1 || day === 21 || day === 31) return day + 'st'; if (day === 2 || day === 22) return day + 'nd'; return day + (day === 3 || day === 23 ? 'rd' : 'th'); }
function weekOf(date) {
  var thursday = new Date(date.getTime()), weeks = 0;
  while (thursday.getUTCDay() !== 4) thursday.setUTCDate(thursday.getUTCDate() + (thursday.getUTCDay() % 5 === 0 || thursday.getUTCDay() === 6 ? -1 : 1));
  for (var year = thursday.getUTCFullYear(); thursday.getUTCFullYear() === year; thursday.setUTCDate(thursday.getUTCDate() - 7)) weeks++;
  return weeks;
}
// A mask falls into runs of one letter, what stands in brackets, and 'Do'.
function cut(mask) {
  var runs = [], at = 0;
  while (at < mask.length) {
    var close = mask.charAt(at) === '[' ? mask.indexOf(']', at) : -1, end = at + 1;
    if (close > end) { runs.push({ letters: '', words: mask.slice(end, close) }); at = close + 1; continue; }
    while (end < mask.length && mask.charAt(end) === mask.charAt(at)) end++;
    if (end === at + 1 && mask.slice(at, end + 1) === 'Do') end++;
    runs.push({ letters: mask.slice(at, end), words: mask.slice(at, end) });
    at = end;
  }
  return runs;
}
function said(letters, date) {
  var hour = date.getUTCHours(), twelve = hour % 12 === 0 ? 12 : hour % 12, month = date.getUTCMonth();
  switch (letters) {
    case 'a': return hour > 11 ? 'pm' : 'am';
    case 'A': return hour > 11 ? 'PM' : 'AM';
    case 's': case 'ss': return wide(date.getUTCSeconds(), letters.length);
    case 'SSS': return wide(date.getUTCMilliseconds(), 3);
    case 'm': case 'mm': return wide(date.getUTCMinutes(), letters.length);
    case 'H': case 'HH': return wide(hour, letters.length);
    case 'h': case 'hh': return wide(twelve, letters.length);
    case 'D': case 'DD': return wide(date.getUTCDate(), letters.length);
    case 'Do': return place(date.getUTCDate());
    case 'ddd': return DAY[date.getUTCDay()].slice(0, 3);
    case 'dddd': return DAY[date.getUTCDay()];
    case 'M': case 'MM': return wide(month + 1, letters.length);
    case 'MMM': return MONTH[month].slice(0, 3);
    case 'MMMM': return MONTH[month];
    case 'Q': return '' + (1 + Math.floor(month / 3));
    case 'W': return '' + weekOf(date);
    case 'X': return '' + Math.floor(date.getTime() / 1000);
    case 'YY': return wide(date.getUTCFullYear() % 100, 2);
    case 'YYYY': return wide(date.getUTCFullYear(), 4);
  }
  return letters;
}
function format(date, mask) {
  var when = new Date(date), words = '';
  if (when.getTime() !== when.getTime()) throw new TypeError('no such date');
  cut(mask).forEach(function (run) { words += run.letters === '' ? run.words : said(run.letters, when); });
  return words;
}
function parse(text, mask) {
  var runs = cut(mask), at = 0, seen = { YYYY: 1970, MM: 1, DD: 1, HH: 0, mm: 0, ss: 0 }, half = '';
  function number(least, most) {
    var value = 0, read = 0;
    while (read < most && text.charCodeAt(at) >= 48 && text.charCodeAt(at) < 58) { value = value * 10 + text.charCodeAt(at) - 48; at += 1; read += 1; }
    return read < least ? -1 : value;
  }
  runs.forEach(function (run) { if (run.letters !== '' && /[a-z]/i.test(run.letters) && !(run.letters in seen) && ['D', 'MMM', 'A'].indexOf(run.letters) < 0) throw new Error('no parser for ' + run.letters); });
  for (var k = 0; k < runs.length; k++) {
    var letters = runs[k].letters, words = runs[k].words;
    if (letters === 'MMM') {
      seen.MM = 0;
      for (var m = 0; m < 12; m++) if (MONTH[m].toUpperCase().startsWith(text.slice(at, at + 3).toUpperCase())) seen.MM = m + 1;
      at += 3;
    } else if (letters === 'A') { half = text.slice(at, at + 2); at += 2; if (half !== 'AM' && half !== 'PM') return null; }
    else if (letters === 'D') seen.DD = number(1, 2);
    else if (letters in seen) seen[letters] = number(letters.length, letters.length);
    else { if (!text.startsWith(words, at)) return null; at += words.length; }
  }
  if (at !== text.length || seen.YYYY < 0 || seen.HH < 0 || seen.mm < 0 || seen.ss < 0) return null;
  if (half !== '') seen.HH = seen.HH % 12 + 12 * (half === 'PM');
  var made = new Date(Date.UTC(seen.YYYY, seen.MM - 1, seen.DD, seen.HH, seen.mm, seen.ss));
  return made.getUTCDate() === seen.DD && made.getUTCMonth() + 1 === seen.MM ? made : null;
}
function add(date, count, unit) {
  var from = new Date(date);
  if (SPAN[unit] !== undefined) return new Date(from.getTime() + SPAN[unit] * count);
  var to = new Date(from.getTime());
  to.setUTCDate(1);
  to.setUTCMonth(to.getUTCMonth() + (unit === 'year' ? 12 : 1) * count);
  for (var day = from.getUTCDate(); day > 28; day--) { var tried = new Date(to.getTime()); tried.setUTCDate(day); if (tried.getUTCMonth() === to.getUTCMonth()) return tried; }
  to.setUTCDate(day);
  return to;
}
function relative(a, b) {
  var seconds = Math.round((b - a) / 1000), size = Math.abs(seconds), unit = '';
  for (var name in STEP) if (STEP[name] <= size) unit = name;
  if (unit === '') return 'now';
  var count = Math.floor(size / STEP[unit]), words = count + ' ' + unit + (count === 1 ? '' : 's');
  return seconds > 0 ? 'in ' + words : words + ' ago';
}
exports.relative = relative;
exports.add = add;
exports.parse = parse;
exports.format = format;
