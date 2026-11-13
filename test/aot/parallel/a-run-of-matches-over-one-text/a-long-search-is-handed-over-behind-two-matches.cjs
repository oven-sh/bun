// COUNT: counter:RegExpLongSearchesInterpreted >= 4
'use strict';
const rounds = Number(process.argv[2] ?? 1);
const short = value => { const text = JSON.stringify(value); return text === undefined ? 'undefined' : text.length > 60 ? text.slice(0, 28) + '..' + text.length + '..' + text.slice(-24) : text; };
const names = ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9', 'lastMatch', 'lastParen', 'leftContext', 'rightContext', 'input'];
const tell = (name, result, re) => console.log('SAID ' + name + ' ' + short(result) + ' ' + names.map(key => key + '=' + short(RegExp[key])).join(' ') + ' lastIndex=' + re.lastIndex);
const prime = () => /(p)(q)/.exec(JSON.parse('"opqr"'));
{
  const text = JSON.parse("\"xxy xxxy \"") + 'x'.repeat(40), re = /(x+x+)+y/g;
  prime(); tell('long remove', text.replace(re, ''), re);
  prime(); tell('long plain', text.replace(re, '-'), re);
  prime(); tell('long template', text.replace(re, '<$1|$&>'), re);
  prime(); tell('long match', text.match(re), re);
}
