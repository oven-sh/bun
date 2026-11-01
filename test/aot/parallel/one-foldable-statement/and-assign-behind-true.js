const isDev = true;
let R = isDev;
R &&= "http://localhost";
console.log(R);
