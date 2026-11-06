// RUN: lower
// CHECK-LABEL: function {{*}}name="equal"
// CHECK: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet {{*}}, [[converted]] key="level"

// RUN(UNEQUAL): lower
// UNEQUAL-LABEL: function {{*}}name="unequal"
// UNEQUAL-NOT: Convert {{*}}declared={type=number site=
// UNEQUAL: PropSet {{*}}key="level"

// A store reaches the setter. The setter of `Gauge` takes more than its getter returns, so the store is not held to the type of the getter: a string is a legal `level`.
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
