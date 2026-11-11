// Strict code. The keys come out of data: negative, a fraction, texts of digits, numbers past 32 bits. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data. Of such keys nobody knows that they are whole numbers: the read stays with the stub.
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
const keys = JSON.parse('[0,-1,1.5,"1","01",2,4294967295,4294967296,4294967297,-0,"length"]');
function keep(first, second) { kept = arguments; const held = arguments; return function read(turn) { let text = "" + turn; for (let i = 0; i < keys.length; i++) text += ":" + held[keys[i]]; return text; }; }
const read = keep(1, "two", null);
for (let turn = 0; turn < 3; turn++) console.log(read(turn));
