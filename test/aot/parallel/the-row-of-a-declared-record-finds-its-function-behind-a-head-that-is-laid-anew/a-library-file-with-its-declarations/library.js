export const first = value => value;
export function aborted(payload, start = 0) {
  for (let index = start; index < payload.issues.length; index++) {
    if (payload.issues[index].stops) return true;
  }
  return false;
}
