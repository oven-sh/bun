export function mysteryBox(callExpression) {
  console.log(callExpression.log);
  // get arguments
  const [countNode] = callExpression.arguments;
  const countString: string = countNode.get();
  const count: number = parseInt(countString, 10);

  // validate
  if (!(count >= 1 && count <= 1000)) return new Error(`Argument ${countString} is expected to be between 1 and 1000`);

  // return a value
  return (Math.random() * count) | 0;
}
