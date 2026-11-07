// The run calls what it finds under the name of the encoder, and a program may store another function there. The module that the build has read out of the address is
// loaded where the run makes the same text.
// RUN: lower
// CHECK-LABEL: function {{*}}name="encoded"
// CHECK: [[expected]] = String string="data:text/javascript,export%20default%201%3B"
// CHECK: [[same]] = StrictEq {{*}}, [[expected]]
// CHECK: Branch [[same]]

// Nothing is called, so nothing is tested.
// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="written"
// WRITTEN-NOT: StrictEq
// WRITTEN: Return

export function encoded() {
  return import("data:text/javascript," + encodeURIComponent("export default 1;"));
}

export function written() {
  return import("data:text/javascript," + "export%20default%202%3B");
}
