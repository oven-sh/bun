class Options { get year() { return "numeric"; } get timeZone() { return "UTC"; } }
console.log(new Intl.DateTimeFormat("en-US", new Options()).format(new Date(0)));
