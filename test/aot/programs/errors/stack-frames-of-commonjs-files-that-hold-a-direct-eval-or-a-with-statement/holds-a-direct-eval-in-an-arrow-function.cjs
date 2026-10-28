show("holds a direct eval in an arrow function, at the top");
function inner() {
  show("holds a direct eval in an arrow function, in a function");
}
inner();
[0].forEach(() => show("holds a direct eval in an arrow function, in a callback"));
exports.later = () => eval("2");
