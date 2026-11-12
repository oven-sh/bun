// An untyped package and a program of it (documents): a reader of tags as events by a state machine, a tree builder and a writer; entities, CDATA, name spaces
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var docs = ['<a/>', '<?xml version="1.0"?><!DOCTYPE a><r x="1" y=\'two\'><b>t &amp; &#65;&#x1F600;</b><!-- c --><c><![CDATA[<raw>&]]></c></r>', '<a><b></a></b>', '<a b=c d>x</a>', '<a b="1" b="2"/>', '<1>', '<a>&unknown; &lt;</a>', '<open><in>', '</x>', 'text only', '<n:s xmlns:n="u"><n:t/></n:s>', '<a / b="1"></a >', ''];
docs.forEach(function (d, i) { [false, true].forEach(function (s) { try { var t = lib.tree(d, s); say(i, s, JSON.stringify(t.children), t.errors.join(';'), lib.write(t)); } catch (e) { say(i, s, e.message); } }); });
