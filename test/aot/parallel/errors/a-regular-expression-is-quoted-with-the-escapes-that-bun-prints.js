// A message quotes a regular expression as Bun prints it: a backslash ahead of a character that is printed as an escape starts that escape, and a control character (the tab of the last but one line) has its escape.
const say = run => { try { run(); } catch (error) { console.log(JSON.stringify(error.message)); } };
const o = {};
say(() => o.nothing(/\é/));
say(() => o.nothing(/\\é/, /\\\é/, /[a-\ÿ]/));
say(() => o.nothing(/\日+/, /\😀/, /[\😀]/u));
say(() => o.nothing(/a	b/, /a\	b/));
say(() => /\é/.nothing());
