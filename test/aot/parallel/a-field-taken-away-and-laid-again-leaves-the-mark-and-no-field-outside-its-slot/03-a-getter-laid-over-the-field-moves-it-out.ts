// Under: --aot-harden=proof-checks: a getter laid over the field does move it out of its slot: the names go the plain way, and back
class Holder { low: number = 1; high: number = 2; bits: number = 4; }
const sum = (holder: Holder): number => holder.low + holder.high + holder.bits;
for (let turn = 0; turn < 3; turn++)
  for (const key of ["low", "high", "bits"]) {
    const holder = new Holder();
    delete (holder as any)[key];
    console.log("SAID taken", key, Object.keys(holder).join(), sum(holder), holder.bits);
    (holder as any)[key] = 6;
    console.log("SAID laid", key, Object.keys(holder).join(), sum(holder), holder.bits);
    Object.defineProperty(holder, key, { get() { return 40; }, enumerable: true, configurable: true });
    console.log("SAID getter", key, Object.keys(holder).join(), sum(holder), holder.bits);
    delete (holder as any)[key]; (holder as any)[key] = 7;
    console.log("SAID laid again", key, Object.keys(holder).join(), sum(holder), holder.bits, JSON.stringify(holder));
  }
