// RUN: link
// CHECK: layout {{*}}kind=Instance name="Bits" {{*}}{key="bytes" declared={type=undefined|null|Uint8Array flags=[IsFromCompiler, IsExpected]} flags=[IsRequired]}, {key="table" declared={type=undefined|null|Uint32Array flags=[IsFromCompiler, IsExpected]} flags=[IsRequired]}, {key="mixed" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}kind=Instance name="Stream" {{*}}{key="buffer" declared={type=undefined|null|Uint8Array flags=[IsFromCompiler, IsExpected]} flags=[IsRequired]}

// A field that its constructor leaves null is expected to hold what the other methods store. One that an unknown call fills is expected to hold the typed array that a field of the same name holds elsewhere in the file.
var Stream = (function () {
  function Stream() {
    this.buffer = null;
  }
  Stream.prototype = {
    grow: function (size) {
      var larger = new Uint8Array(size);
      return (this.buffer = larger);
    },
  };
  return Stream;
})();

class Bits {
  constructor(source) {
    this.bytes = source.take();
    this.table = undefined;
    this.mixed = null;
  }
  fill(size) {
    this.table = new Uint32Array(size);
    this.mixed = size ? new Uint8Array(size) : this;
  }
}

function Reader(list) {
  this.bytes = new Uint8Array(list);
}

export const made = [new Stream().grow(4), new Bits({ take: () => new Reader([1]).bytes }), Reader];
