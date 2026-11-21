import url, { domainToASCII, format } from "node:url";
console.log(
  domainToASCII("example.com"),
  url.domainToASCII("example.com"),
  typeof format,
  domainToASCII === url.domainToASCII,
);
