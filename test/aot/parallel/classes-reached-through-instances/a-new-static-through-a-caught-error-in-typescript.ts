try {
  (null as any).x;
} catch (e: any) {
  e.constructor.extra = 41;
}
function read(): unknown {
  return (TypeError as any).extra;
}
console.log(read());
