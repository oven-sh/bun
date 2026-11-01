export function Base(size) {
  this.size = size;
}
Base.prototype.area = function () {
  return this.size * 2;
};
