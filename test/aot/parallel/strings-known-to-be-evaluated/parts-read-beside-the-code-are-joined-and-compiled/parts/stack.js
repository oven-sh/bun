function Stack(name) {
  this.name = name;
  this.held = [];
}
Stack.prototype.put = function (text) {
  var size = measure(text);
  if (size >= 0) this.held.push(size);
  return this;
};
Stack.prototype.sum = function () {
  var all = 0;
  for (var at = 0; at < this.held.length; at++) all += this.held[at];
  return all;
};
