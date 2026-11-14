function tagged(value) {
  return [this.tag, value];
}
module.exports = tagged.bind({ tag: "bound" });
