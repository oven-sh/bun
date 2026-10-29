export function then(resolve, reject) {
  reject(new RangeError("rejected by then"));
}
