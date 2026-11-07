// The value of a comma expression in brackets is printed in the place of the constant that holds it, without the operand in front.
const isDev = false;
const devUrl = "http://localhost";
const R = (isDev, devUrl);
try {
  null[String(R)];
} catch (e) {
  console.log(e.message);
}
