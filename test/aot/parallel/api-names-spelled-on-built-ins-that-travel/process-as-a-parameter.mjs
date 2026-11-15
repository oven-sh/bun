function use(p) {
  return p.kill(p.pid, 0);
}
console.log(use(process));
