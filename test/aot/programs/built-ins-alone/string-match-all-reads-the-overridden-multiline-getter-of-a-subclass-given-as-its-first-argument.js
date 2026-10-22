let calls = 0;
class Special extends RegExp {
  count = 0;
  get multiline() {
    calls++;
    this.count++;
    console.log("multiline");
    return super.multiline;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".matchAll(special);
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0].length, step.value[0]);
console.log(typeof step.value[1], step.value[1].length, step.value[1]);
console.log(typeof step.value[2], step.value[2].length, step.value[2], typeof step.value[3], step.value[3] === undefined);
console.log(typeof step.value.index, step.value.index + 1, typeof step.value.input, step.value.input.length, step.value.input);
console.log(typeof step.value.groups, [...result].length);
console.log(calls, special.count);
