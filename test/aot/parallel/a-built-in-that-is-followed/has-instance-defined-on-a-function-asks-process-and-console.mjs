// The method may be laid on a function by a definition, and the left operand may be any object of the host.
function Kind() {}
Object.defineProperty(Kind, Symbol.hasInstance, {
  value(value) {
    return typeof (value.finalization ?? value.Console);
  },
});
console.log(process instanceof Kind, console instanceof Kind);
