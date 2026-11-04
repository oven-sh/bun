const isDev = true;
let R;
switch (true) {
  case !!isDev:
    R = "http://localhost";
    break;
  default:
    R = "https://example.com";
}
console.log(R);
