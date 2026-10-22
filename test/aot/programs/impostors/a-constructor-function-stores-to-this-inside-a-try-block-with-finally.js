function Packet(link) {
  try {
    this.link = link;
  } finally {
    this.done = true;
  }
}
console.log(new Packet(null).link);
