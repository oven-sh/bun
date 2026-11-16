// RUN: lower
// CHECK-LABEL: function {{*}}name="dynamic"
// CHECK: ScopeHasBinding {{*}}key="name"
// CHECK: PropGet {{*}}key="field"
// CHECK: PropSet {{*}}key="name"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: ScopeHasBinding
// CHECK-LABEL: function {{*}}name="lexical"
// CHECK-NOT: ScopeHasBinding

function dynamic(o) {
  with (o) {
    var name = this.field;
  }
}

function plain() {
  var name = this.field;
}

function lexical(o) {
  with (o) {
    let name = this.field;
  }
}

module.exports = { dynamic, plain, lexical };
