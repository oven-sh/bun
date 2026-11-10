type Step = ["push", number] | ["add"] | ["mul"] | ["neg"];
function run(steps: Step[]): number {
  const stack: number[] = [];
  for (const step of steps) {
    switch (step[0]) {
      case "push":
        stack.push(step[1]);
        break;
      case "add":
        stack.push(stack.pop()! + stack.pop()!);
        break;
      case "mul":
        stack.push(stack.pop()! * stack.pop()!);
        break;
      case "neg":
        stack.push(-stack.pop()!);
        break;
    }
  }
  return stack[0];
}
console.log(run([["push", 2], ["push", 3], ["add"], ["push", 4], ["mul"], ["neg"]]));
