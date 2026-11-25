// An untyped package and a program of it (lists): wildcards to expressions, braces, negation, a cache
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var files = 'a.js b.ts src/a.js src/b.test.js src/deep/c.js src/deep/d.ts test/x.js README.md .env src/[x].js'.split(' ');
[['*.js'], ['**/*.js'], ['**/*.js', '!**/*.test.js'], ['src/**'], ['{src,test}/**/*.{js,ts}'], ['?.??'], ['src/[a-b]*.js'], ['[!a].ts'], ['*', '!.*'], ['!a.js'], ['src/**/c.js', 'src/**/d.ts']].forEach(function (p, i) { for (var k = 0; k < 2; k++) say(i, p.join(' '), lib.filter(k ? files.slice().reverse() : files, p).join()); });
say(lib.expand('a{b,c{d,e}}f').join(), lib.hits());
