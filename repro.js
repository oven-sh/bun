const str1 = Object("abc");
const str2 = Object("abc");
str2.slow = true;

console.log(Bun.deepEquals(str1, str2)); // should be 'false'
