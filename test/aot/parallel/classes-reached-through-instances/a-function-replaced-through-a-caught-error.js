TypeError.say = function () {
  return "older";
};
try {
  null.x;
} catch (e) {
  e.constructor.say = function () {
    return "newer";
  };
}
function read() {
  return TypeError.say();
}
console.log(read());
