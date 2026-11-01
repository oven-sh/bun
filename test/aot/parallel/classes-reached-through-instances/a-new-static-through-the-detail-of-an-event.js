const hide = v => new CustomEvent("x", { detail: v }).detail;
hide(new WeakRef({})).constructor.extra = 41;
function read() {
  return WeakRef.extra;
}
console.log(read(), WeakRef.extra ?? "absent", WeakRef.extra + 1);
