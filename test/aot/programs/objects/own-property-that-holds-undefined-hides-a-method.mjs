// The streams behind console store undefined under the names of two methods of their class. A read finds the undefined, not the method.
import "node:child_process";
function say(read) {
  console.log(typeof read());
}
say(() => 1);
say(() => console._stdout._writev);
say(() => console._stdout._construct);
say(() => console._stderr._writev);
