const isDev = false;
const R = (isDev ? /a/ : /z/).test("abc");
console.log(R);
