export function markOf(value) {
  return value.planted;
}
export function callMark(value) {
  try {
    return value.planted();
  } catch (error) {
    return error.constructor.name;
  }
}
