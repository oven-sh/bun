// Each line: the message of the ReferenceError of a pattern that stores to a variable ahead of its declaration. The stored output names the variable.
function one() { [a] = [1]; let a; }
function two() { ({ a } = { a: 1 }); let a; }
function three() { [a, b] = [1, 2]; let a, b; }
function four() { [[a]] = [[1]]; let a; }
function five() { [...a] = [1]; let a; }
function six() { [a = 2] = []; let a; }
function seven() { a = 1; let a; }
function eight() { ({ x: a } = { x: 1 }); let a; }
function nine() { for ([a] of [[1]]) {} let a; }
function eleven() { [a] = [1]; class a {} }
for (const f of [one, two, three, four, five, six, seven, eight, nine, eleven]) {
  try { f(); console.log(f.name, "no error"); } catch (error) { console.log(f.name, error.name, error.message); }
}
