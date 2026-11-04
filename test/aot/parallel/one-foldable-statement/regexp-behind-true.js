const isDev = true;
const R = (isDev ? /a/ : /z/).test("abc");
console.log(R);
