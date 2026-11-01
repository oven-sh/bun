const isDev = true;
let R = "https://example.com";
for (let i = 0; isDev && i < 1; i++) R = "http://localhost";
console.log(R);
