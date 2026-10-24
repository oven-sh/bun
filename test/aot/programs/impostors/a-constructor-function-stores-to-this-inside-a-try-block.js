function Packet(link) {
  try {
    this.link = link;
  } catch (e) {}
}
console.log(new Packet(null).link);
