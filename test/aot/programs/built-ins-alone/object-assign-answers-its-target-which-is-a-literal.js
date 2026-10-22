function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const answer = Object.assign(target, { value: "text" });
console.log(answer === target, typeof answer.value, answer.value.length);
