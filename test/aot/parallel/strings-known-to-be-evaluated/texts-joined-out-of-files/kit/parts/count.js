var total_ = given.start;
function add(n) {
  total_ += n;
  return total_ % 7;
}
function total() {
  return total_;
}
