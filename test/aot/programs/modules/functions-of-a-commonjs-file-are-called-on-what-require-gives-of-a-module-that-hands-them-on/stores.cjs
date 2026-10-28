function callsStored() {
  return this.stored() + " " + typeof this.copied;
}
function stored() {
  return "stored";
}
module.exports = { callsStored, stored };
