class Options {
  get timeZone() {
    return "UTC";
  }
  get hour() {
    return "2-digit";
  }
}
const start = new Date(0);
console.log(new Intl.DateTimeFormat("en", new Options()).format(start));
console.log(start.toLocaleTimeString("en", new Options()));
