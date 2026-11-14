// The two halves of a surrogate pair join where constant strings meet, so both spellings are one key.
const high = "\ud83d", low = "\ude00";
const joined = `${high}${low}`;
console.log(Object.keys({ [joined]: 1, "\u{1F600}": 2 }).length);
console.log(Object.keys({ [`\ud83d${""}\ude00`]: 1, "\u{1F600}": 2 }).length);
console.log(Object.keys({ [high + low]: 1, "\u{1F600}": 2 }).length);
const faces = { [`${high}\ude00`]: "grin", [`${high}\ude01`]: "beam" };
const all = { ...faces, ...{ "\u{1F600}": "smile", "\u{1F680}": "rocket" } };
console.log(Object.keys(all).length, all["\u{1F600}"], all[`${high}\ude01`]);
console.log(Object.keys({ [`${low}${high}`]: 1, [low + high]: 2, "\u{1F600}": 3 }).length);
