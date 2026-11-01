// Text as a minifier leaves it: no blank in front of `in`, behind `for` or behind the head of an `if`, and a regular expression with a quote in it in front of the place, in one line.
// prettier-ignore
var none=globalThis.nothingHere,held={text:""},step=1;
// prettier-ignore
var tries=[
function(){"k"in none},
function(){held.k=held["k"]in none},
function(){for(const x of held.n){held.x=x}},
function(){for(var[a,b]of held.n){held.x=a+b}},
function(){if(step===1)(held.a||none).b},
function(){while(step===1)(held.a||none).b},
function(){if(step===1)(held.a||none).b()},
function(){held.y=/[;)'"\]]/.test(held.text);none[held.key]},
function(){held.y=/[;)'"\]]/.test(held.text);delete none.d},
function(){held.y=/[;)'"\]]/.test(held.text);"k" in none},
function(){held.y=/[;)'"\]]/.test(held.text);held instanceof none},
function(){held.y=/[;)'"\]]/.test(held.text);held[held.key]()},
function(){held.y=step/2/1;held.z="'";none[held.key]},
function(){return/'/.test(held.text)||none[held.key]},
];
for (const attempt of tries) {
  try {
    attempt();
    console.log("nothing thrown");
  } catch (error) {
    console.log(String(error.message));
  }
}
