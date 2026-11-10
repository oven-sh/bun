function once(work) {
  let done = false;
  let answer;
  return function (...given) {
    if (!done) {
      done = true;
      answer = work(...given);
    }
    return answer;
  };
}
function greet(name) {
  return "hello " + name;
}
const first = once(greet);
console.log(first("ann"), first("bob"));
