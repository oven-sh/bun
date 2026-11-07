// The idiom of libraries from before classes: is the method still the one I know?
function Stream() {
  this.flowing = false;
}
Stream.prototype.resume = function () {
  this.flowing = true;
  return this;
};
Stream.prototype.pause = function () {
  this.flowing = false;
  return this;
};
function Socket() {
  Stream.call(this);
}
Object.setPrototypeOf(Socket.prototype, Stream.prototype);
Object.setPrototypeOf(Socket, Stream);
Socket.prototype.end = function () {
  return "ended";
};
const { resume, pause } = Stream.prototype;
const { end } = Socket.prototype;
function isUntouched(socket) {
  return socket.resume === resume && socket.pause === pause && socket.end === end;
}
const lines = [];
let sockets = [new Socket(), new Socket(), new Socket()];
function count(name) {
  let untouched = 0;
  for (let i = 0; i < 6; i++) untouched += isUntouched(sockets[i % 3]) ? 1 : 0;
  lines.push(name + " " + untouched);
}
count("at first");
sockets[1].pause = () => "mine";
count("one object overrides");
delete sockets[1].pause;
count("no longer");
const wrapped = Stream.prototype.resume;
Stream.prototype.resume = function () {
  return wrapped.call(this);
};
count("the library is patched");
Stream.prototype.resume = wrapped;
count("and restored");
class Tls extends Socket {
  end() {
    return "tls";
  }
}
sockets = [new Tls(), new Socket(), new Tls()];
count("a class below overrides");
console.log(lines.join("\n"));
