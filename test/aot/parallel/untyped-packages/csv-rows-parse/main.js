// An untyped package and a program of it (parse): comma separated rows with quotes, delimiters found by counting, headers, casts and a writer
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var texts = ['a,b,c\n1,2,3\n4,"five, 5","six ""6"""\n', 'x;y\r\n1.5;true\r\n-2;\r\n', 'n\tv\n"multi\nline"\t0\n', 'a|b\n1|2|3\n4\n', '# note\na,b\n# more\n1,2', '"open', ' a , b \n 1 , " 2 "\n', '', '\n\n', 'q\n"a"b,c\n', '1e3,.5,9007199254740993,-0,00'];
texts.forEach(function (t, i) { [{}, { header: true }, { cast: true, trim: true, comment: '#' }, { header: true, cast: true, relax: true, comment: '#' }].forEach(function (o, k) { var r = lib.parse(t, o); say(i, k, JSON.stringify(r), r.errors.join(';')); }); });
