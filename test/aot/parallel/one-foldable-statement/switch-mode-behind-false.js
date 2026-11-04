const isDev = false;
const mode = isDev ? "dev" : "prod";
let R;
switch (mode) {
  case "dev":
    R = "http://localhost";
    break;
  case "prod":
    R = "https://example.com";
    break;
}
console.log(R);
