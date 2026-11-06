export function describeError(error) {
  return `${error.constructor.name}: ${error.message.replace(/"[^"]*[\\/]([^"\\/]+)"/g, '"$1"')}`;
}
