fetch.preconnect("bun");
fetch("bun");

fetch("bun", {
  verbose: true,
});

const init: RequestInit = {
  proxy: "12345",
  verbose: true,
  method: "GET",
};
