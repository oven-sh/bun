import tls from "node:tls";

tls.connect({
  host: "localhost",
  port: 80,
  ca: "asdf",
});

tls.connect({
  host: "localhost",
  port: 80,
  ca: Bun.file("asdf"),
});
