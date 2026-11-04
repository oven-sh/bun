const hide = v => new CustomEvent("x", { detail: v }).detail;
hide(new WeakRef({})).constructor.extra = function () {
  return "mine";
};
console.log(WeakRef.extra.call(null));
