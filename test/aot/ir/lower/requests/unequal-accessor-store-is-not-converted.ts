// RUN: lower
// CHECK-LABEL: function {{*}}name="equal"
// CHECK: b0({{*}}, [[next]]: anything):
// CHECK-NOT: Convert
// CHECK: PropSet {{*}}, [[next]] key="level"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="unequal"
// CHECK: b0({{*}}, [[other]]: anything):
// CHECK-NOT: Convert
// CHECK: PropSet {{*}}, [[other]] key="level"
// CHECK-NOT: Convert

// A store reaches the setter, which tests its parameter. So the store is converted to nothing, whether the setter takes what its getter returns or more: a string is a legal `level` of a `Gauge`.
class Meter {
  get level(): number {
    return 1;
  }
  set level(next: number) {}
}

class Gauge {
  get level(): number {
    return 1;
  }
  set level(next: number | string) {}
}

export function equal(meter: Meter, next: any) {
  meter.level = next;
}

export function unequal(gauge: Gauge, next: any) {
  gauge.level = next;
}
