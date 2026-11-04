// The written type lets the field be left out. One literal lays the pair, another leaves the name out and gets a value of its own by the same store that runs the setter of the first.
type Meter = { raw: number; value?: number };
function put(meter: Meter, next: number) { meter.value = next; }
function main() {
  const computed: Meter = { raw: 0, get value(): number { return this.raw + 100; }, set value(next: number | undefined) { this.raw = next ?? -1; } };
  const bare: Meter = { raw: 0 };
  console.log(bare.value, "value" in bare, computed.value);
  for (let i = 0; i < 300; i++) { put(computed, i); put(bare, i); }
  console.log(computed.raw, computed.value, bare.raw, bare.value, Object.keys(bare).join(), Object.keys(computed).join());
  console.log(typeof Object.getOwnPropertyDescriptor(bare, "value")!.get, typeof Object.getOwnPropertyDescriptor(computed, "value")!.get);
}
main();
