// Objects are made before the default is stored, the default is stored from a function that runs late, and replaced by another value.
const log = [];
function Message(url) {
  this.id = 1;
  if (url !== undefined) this.url = url;
}
function make(n, url) {
  let last;
  for (let i = 0; i < n; i++) last = new Message(url);
  return last;
}
log.push(String(make(30).url), make(30, "/a").url);
function late() {
  Message.prototype.url = "default";
}
setTimeout(() => {
  late();
  log.push(make(30).url, make(30, "/b").url, Object.keys(make(1, "/c")).join(), Object.keys(make(1)).join());
  Message.prototype.url = "other";
  log.push(make(30).url, make(30, "/d").url);
  console.log(log.join(" | "));
}, 1);
