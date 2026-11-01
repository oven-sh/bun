const isDev = false;
let R = isDev;
R &&= "http://localhost";
console.log(R);
