export function twice(x: number) {
  return x * 2;
}
export const table = {
  size: 3,
  grow(by: number) {
    this.size += by;
    return this.size;
  },
};
