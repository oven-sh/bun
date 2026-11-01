const isDev = true;
let R = isDev;
R ??= "https://example.com";
console.log(R);
