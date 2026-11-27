function report(stacks) {
  return stacks
    .map(function (stack) {
      return stack.name + "=" + stack.sum() + between();
    })
    .join("");
}
