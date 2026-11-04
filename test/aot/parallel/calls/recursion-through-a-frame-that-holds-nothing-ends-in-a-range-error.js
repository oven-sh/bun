// a function whose frame holds nothing but the return address of its callee calls itself until the stack ends; the error is caught, and the program goes on
function down(n) {
  down(n + 1);
  return 1;
}
function deed() {
  try {
    down(0);
    return "no end";
  } catch (error) {
    return error.name;
  }
}
console.log(deed());
for (let turn = 0; turn < 3; turn++) console.log(deed());
console.log(String(1 + 1));
