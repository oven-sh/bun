// The two options that say how the values of headers are held, handed to a request of a client: what they let through, and where they lie among the own names of the request and of a server.
import http from "node:http";
import http2 from "node:http2";

const sink = http.createServer((req, res) => res.end("ok"));
await new Promise(resolve => sink.listen(0, "127.0.0.1", resolve));
const around = (object, name) => {
  const names = Object.keys(object);
  const at = names.indexOf(name);
  return at < 0
    ? name + " is no own name"
    : names.slice(Math.max(0, at - 1), at + 2).join(" ") + " = " + String(object[name]);
};
for (const options of [
  {},
  { insecureHTTPParser: true },
  { insecureHTTPParser: false },
  { httpValidation: "relaxed" },
  { httpValidation: "strict" },
  { httpValidation: "insecure" },
]) {
  const request = http.request({ host: "127.0.0.1", port: sink.address().port, agent: false, ...options });
  let seen;
  try {
    request.setHeader("x-odd", "a\u0001b");
    seen = "taken";
  } catch (error) {
    seen = error.code;
  }
  console.log(
    JSON.stringify(options),
    "|",
    seen,
    "|",
    around(request, "insecureHTTPParser"),
    "|",
    around(request, "httpValidation"),
  );
  request.removeHeader("x-odd");
  await new Promise(resolve => {
    request.on("response", response => response.resume().on("end", resolve));
    request.end();
  });
}
for (const options of [{}, { insecureHTTPParser: true }, { httpValidation: "relaxed" }]) {
  const server = http.createServer(options);
  console.log(
    "a server made with",
    JSON.stringify(options),
    "|",
    around(server, "insecureHTTPParser"),
    "|",
    around(server, "httpValidation"),
  );
}
for (const options of [
  { insecureHTTPParser: 1 },
  { httpValidation: "loose" },
  { httpValidation: "strict", insecureHTTPParser: true },
]) {
  for (const make of [
    () => http.createServer(options),
    () => http.request({ host: "127.0.0.1", port: 1, ...options }),
  ]) {
    try {
      make();
      console.log(JSON.stringify(options), "is taken");
    } catch (error) {
      console.log(JSON.stringify(options), error.code);
    }
  }
}
for (const options of [
  { allowHTTP1: true },
  { allowHTTP1: true, insecureHTTPParser: true },
  { allowHTTP1: true, httpValidation: "relaxed" },
  { insecureHTTPParser: true },
]) {
  const server = http2.createSecureServer(options);
  console.log(
    "a secure server of the second protocol made with",
    JSON.stringify(options),
    "|",
    around(server, "insecureHTTPParser"),
    "|",
    around(server, "httpValidation"),
  );
}
sink.close();
